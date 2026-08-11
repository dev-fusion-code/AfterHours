import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Room, Student, Answer, WhiteboardStroke, ChatMessage

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_code = self.scope['url_route']['kwargs']['room_code'].upper()
        self.room_group_name = f'room_{self.room_code}'
        self.teacher_group_name = f'room_teachers_{self.room_code}'

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        room_state = await self.get_room_state(self.room_code)
        if room_state:
            await self.send(text_data=json.dumps({
                'type': 'init_state',
                'active_question': room_state['active_question'],
                'question_type': room_state['question_type'],
                'quiz_options': room_state['quiz_options'],
                'round': room_state['question_round'],
                'correct_answer': room_state['correct_answer'],
                'is_revealed': room_state['is_revealed'],
                'recent_answers': room_state['recent_answers'],
                'students': room_state['students'],
                'approved_students': room_state['approved_students'],
                'strokes': room_state['strokes'],
                'current_slide_index': room_state['current_slide_index'],
                'total_slides': room_state['total_slides'],
                'slide_title': room_state['slide_title'],
                'slide_data_url': room_state.get('slide_data_url', ''),
                'canvas_mode': room_state.get('canvas_mode', 'pdf'),
                'recent_chats': room_state['recent_chats'],
            }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        event_type = data.get('type')

        if event_type == 'register_role':
            role = data.get('role')
            if role == 'teacher':
                await self.channel_layer.group_add(self.teacher_group_name, self.channel_name)
            elif role == 'student':
                student_name = data.get('student_name', '').strip()
                if student_name:
                    student_group = f'room_student_{student_name}_{self.room_code}'
                    await self.channel_layer.group_add(student_group, self.channel_name)

        elif event_type == 'push_question':
            question = data.get('question', '').strip()
            q_type = data.get('question_type', 'SHORT_ANSWER')
            options = data.get('quiz_options', [])
            correct_answer = data.get('correct_answer', '').strip()

            room_info = await self.save_pushed_question(self.room_code, question, q_type, options, correct_answer)

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_question',
                    'question': question,
                    'question_type': q_type,
                    'quiz_options': options,
                    'correct_answer': correct_answer,
                    'round': room_info['round'],
                }
            )

        elif event_type == 'draw_stroke':
            stroke = data.get('stroke', {})
            student_name = data.get('student_name', 'Teacher')
            is_private = stroke.get('is_private', False) or data.get('is_private', False)

            if is_private:
                # Private drawing: route directly to teacher console ONLY
                await self.channel_layer.group_send(
                    self.teacher_group_name,
                    {
                        'type': 'broadcast_private_stroke',
                        'stroke': stroke,
                        'student_name': student_name,
                    }
                )
            else:
                is_allowed = await self.check_drawing_permission(self.room_code, student_name)
                if is_allowed:
                    await self.save_whiteboard_stroke(self.room_code, stroke)
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'broadcast_stroke',
                            'stroke': stroke,
                            'student_name': student_name,
                        }
                    )

        elif event_type == 'undo_stroke':
            student_name = data.get('student_name', 'Teacher')
            is_allowed = await self.check_drawing_permission(self.room_code, student_name)

            if is_allowed:
                await self.undo_last_whiteboard_stroke(self.room_code)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'broadcast_undo_stroke',
                    }
                )

        elif event_type == 'clear_whiteboard':
            student_name = data.get('student_name', 'Teacher')
            is_allowed = await self.check_drawing_permission(self.room_code, student_name)

            if is_allowed:
                await self.clear_whiteboard_strokes(self.room_code)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'broadcast_clear_whiteboard',
                    }
                )

        elif event_type == 'change_slide':
            slide_index = data.get('slide_index', 1)
            total_slides = data.get('total_slides', 5)
            slide_title = data.get('slide_title', 'Lecture Presentation')
            slide_data_url = data.get('slide_data_url', '')

            await self.save_slide_state(self.room_code, slide_index, total_slides, slide_title, slide_data_url)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_slide_changed',
                    'slide_index': slide_index,
                    'total_slides': total_slides,
                    'slide_title': slide_title,
                    'slide_data_url': slide_data_url,
                }
            )

        elif event_type == 'set_canvas_mode':
            mode = data.get('mode', 'pdf') # 'pdf' or 'blank'
            await self.save_canvas_mode(self.room_code, mode)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_canvas_mode',
                    'mode': mode,
                }
            )

        elif event_type == 'laser_move':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_laser_move',
                    'x': data.get('x', 0),
                    'y': data.get('y', 0),
                    'student_name': data.get('student_name', 'Teacher'),
                    'is_teacher': data.get('is_teacher', False),
                    'active': data.get('active', True),
                }
            )

        elif event_type == 'chat_message':
            sender = data.get('sender_name', 'Anonymous').strip()
            msg_text = data.get('message', '').strip()
            is_teacher = data.get('is_teacher', False)
            is_private = data.get('is_private', False)
            recipient_name = data.get('recipient_name', 'Teacher')

            if msg_text:
                msg_data = await self.save_chat_message(self.room_code, sender, msg_text, is_teacher, is_private, recipient_name)
                
                chat_payload = {
                    'type': 'broadcast_chat_message',
                    'sender_name': sender,
                    'message': msg_text,
                    'is_teacher': is_teacher,
                    'is_private': is_private,
                    'recipient_name': recipient_name,
                    'timestamp': msg_data['timestamp'],
                }

                if is_private:
                    # Route private DM ONLY to teacher group and specific student group
                    await self.channel_layer.group_send(self.teacher_group_name, chat_payload)
                    if not is_teacher:
                        student_group = f'room_student_{sender}_{self.room_code}'
                        await self.channel_layer.group_send(student_group, chat_payload)
                    elif recipient_name and recipient_name != 'Teacher':
                        student_group = f'room_student_{recipient_name}_{self.room_code}'
                        await self.channel_layer.group_send(student_group, chat_payload)
                else:
                    await self.channel_layer.group_send(self.room_group_name, chat_payload)

        elif event_type == 'toggle_student_permission':
            student_name = data.get('student_name')
            approved = data.get('approved', False)

            approved_list = await self.set_student_permission(self.room_code, student_name, approved)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_permission_change',
                    'student_name': student_name,
                    'approved': approved,
                    'approved_students': approved_list,
                }
            )

        elif event_type == 'submit_answer':
            student_name = data.get('student_name', 'Anonymous').strip()
            answer_val = data.get('answer', '').strip()
            round_num = data.get('round', 0)

            if answer_val:
                await self.save_student_answer(self.room_code, student_name, answer_val, round_num)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'broadcast_answer',
                        'student_name': student_name,
                        'answer': answer_val,
                        'round': round_num,
                    }
                )

        elif event_type == 'reveal_answer':
            correct_answer = data.get('correct_answer', '').strip()
            await self.set_answer_revealed(self.room_code, correct_answer)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_reveal',
                    'correct_answer': correct_answer,
                }
            )

        elif event_type == 'reset_round':
            room_info = await self.reset_room_round(self.room_code)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_reset',
                    'round': room_info['round'],
                }
            )

        elif event_type == 'student_joined':
            student_name = data.get('student_name', '').strip()
            if student_name:
                student_group = f'room_student_{student_name}_{self.room_code}'
                await self.channel_layer.group_add(student_group, self.channel_name)
                students_info = await self.register_student_join(self.room_code, student_name)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'broadcast_student_joined',
                        'student_name': student_name,
                        'students': students_info['students'],
                        'approved_students': students_info['approved_students'],
                    }
                )

    # Handlers
    async def broadcast_question(self, event):
        await self.send(text_data=json.dumps({
            'type': 'question_pushed',
            'question': event['question'],
            'question_type': event.get('question_type', 'SHORT_ANSWER'),
            'quiz_options': event.get('quiz_options', []),
            'correct_answer': event.get('correct_answer', ''),
            'round': event['round'],
        }))

    async def broadcast_stroke(self, event):
        await self.send(text_data=json.dumps({
            'type': 'stroke_drawn',
            'stroke': event['stroke'],
            'student_name': event.get('student_name', ''),
        }))

    async def broadcast_private_stroke(self, event):
        await self.send(text_data=json.dumps({
            'type': 'private_stroke_drawn',
            'stroke': event['stroke'],
            'student_name': event.get('student_name', ''),
        }))

    async def broadcast_undo_stroke(self, event):
        await self.send(text_data=json.dumps({
            'type': 'stroke_undone',
        }))

    async def broadcast_clear_whiteboard(self, event):
        await self.send(text_data=json.dumps({
            'type': 'whiteboard_cleared',
        }))

    async def broadcast_slide_changed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'slide_changed',
            'slide_index': event['slide_index'],
            'total_slides': event['total_slides'],
            'slide_title': event.get('slide_title', 'Lecture Presentation'),
            'slide_data_url': event.get('slide_data_url', ''),
        }))

    async def broadcast_canvas_mode(self, event):
        await self.send(text_data=json.dumps({
            'type': 'canvas_mode_changed',
            'mode': event['mode'],
        }))

    async def broadcast_laser_move(self, event):
        await self.send(text_data=json.dumps({
            'type': 'laser_moved',
            'x': event['x'],
            'y': event['y'],
            'student_name': event['student_name'],
            'is_teacher': event['is_teacher'],
            'active': event['active'],
        }))

    async def broadcast_chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_received',
            'sender_name': event['sender_name'],
            'message': event['message'],
            'is_teacher': event['is_teacher'],
            'is_private': event.get('is_private', False),
            'recipient_name': event.get('recipient_name', 'Teacher'),
            'timestamp': event['timestamp'],
        }))

    async def broadcast_permission_change(self, event):
        await self.send(text_data=json.dumps({
            'type': 'permission_updated',
            'student_name': event['student_name'],
            'approved': event['approved'],
            'approved_students': event['approved_students'],
        }))

    async def broadcast_answer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'answer_submitted',
            'student_name': event['student_name'],
            'answer': event['answer'],
            'round': event['round'],
        }))

    async def broadcast_reveal(self, event):
        await self.send(text_data=json.dumps({
            'type': 'answer_revealed',
            'correct_answer': event['correct_answer'],
        }))

    async def broadcast_reset(self, event):
        await self.send(text_data=json.dumps({
            'type': 'round_reset',
            'round': event['round'],
        }))

    async def broadcast_student_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'student_joined',
            'student_name': event['student_name'],
            'students': event.get('students', []),
            'approved_students': event.get('approved_students', []),
        }))

    # DB Helpers
    @database_sync_to_async
    def get_room_state(self, room_code):
        try:
            room = Room.objects.get(code=room_code)
            students = list(room.students.values_list('name', flat=True))
            approved_students = list(room.students.filter(is_whiteboard_approved=True).values_list('name', flat=True))
            current_answers = list(Answer.objects.filter(
                room=room, question_round=room.question_round
            ).select_related('student').values('student__name', 'value', 'submitted_at'))

            strokes = list(room.strokes.values_list('stroke_data', flat=True))
            chats = list(room.chat_messages.values('sender_name', 'is_teacher', 'is_private', 'recipient_name', 'message', 'timestamp')[:50])

            formatted_answers = [
                {'student_name': a['student__name'], 'answer': a['value']}
                for a in current_answers
            ]

            formatted_chats = [
                {
                    'sender_name': c['sender_name'],
                    'is_teacher': c['is_teacher'],
                    'is_private': c.get('is_private', False),
                    'recipient_name': c.get('recipient_name', 'Teacher'),
                    'message': c['message'],
                    'timestamp': c['timestamp'].strftime('%H:%M'),
                }
                for c in chats
            ]

            return {
                'active_question': room.active_question,
                'question_type': room.question_type,
                'quiz_options': room.quiz_options or [],
                'question_round': room.question_round,
                'correct_answer': room.correct_answer,
                'is_revealed': room.is_revealed,
                'recent_answers': formatted_answers,
                'students': students,
                'approved_students': approved_students,
                'strokes': strokes,
                'current_slide_index': room.current_slide_index,
                'total_slides': room.total_slides,
                'slide_title': room.slide_title,
                'slide_data_url': room.slide_data_url or '',
                'canvas_mode': room.canvas_mode or 'pdf',
                'recent_chats': formatted_chats,
            }
        except Room.DoesNotExist:
            return None

    @database_sync_to_async
    def check_drawing_permission(self, room_code, student_name):
        if not student_name or 'Teacher' in student_name or 'Instructor' in student_name:
            return True
        try:
            room = Room.objects.get(code=room_code)
            student = Student.objects.get(room=room, name=student_name)
            return student.is_whiteboard_approved
        except (Room.DoesNotExist, Student.DoesNotExist):
            return False

    @database_sync_to_async
    def save_whiteboard_stroke(self, room_code, stroke_data):
        try:
            room = Room.objects.get(code=room_code)
            WhiteboardStroke.objects.create(room=room, stroke_data=stroke_data)
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def undo_last_whiteboard_stroke(self, room_code):
        try:
            room = Room.objects.get(code=room_code)
            last_stroke = WhiteboardStroke.objects.filter(room=room).last()
            if last_stroke:
                last_stroke.delete()
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def clear_whiteboard_strokes(self, room_code):
        try:
            room = Room.objects.get(code=room_code)
            WhiteboardStroke.objects.filter(room=room).delete()
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def save_slide_state(self, room_code, slide_index, total_slides, slide_title, slide_data_url=''):
        try:
            room = Room.objects.get(code=room_code)
            room.current_slide_index = slide_index
            room.total_slides = total_slides
            if slide_title:
                room.slide_title = slide_title
            if slide_data_url:
                room.slide_data_url = slide_data_url
            room.save()
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def save_canvas_mode(self, room_code, mode):
        try:
            room = Room.objects.get(code=room_code)
            room.canvas_mode = mode
            room.save()
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def save_chat_message(self, room_code, sender, msg_text, is_teacher, is_private=False, recipient_name='Teacher'):
        try:
            room = Room.objects.get(code=room_code)
            msg = ChatMessage.objects.create(
                room=room,
                sender_name=sender,
                message=msg_text,
                is_teacher=is_teacher,
                is_private=is_private,
                recipient_name=recipient_name
            )
            return {'timestamp': msg.timestamp.strftime('%H:%M')}
        except Room.DoesNotExist:
            return {'timestamp': ''}

    @database_sync_to_async
    def set_student_permission(self, room_code, student_name, approved):
        try:
            room = Room.objects.get(code=room_code)
            student = Student.objects.get(room=room, name=student_name)
            student.is_whiteboard_approved = approved
            student.save()
            return list(room.students.filter(is_whiteboard_approved=True).values_list('name', flat=True))
        except (Room.DoesNotExist, Student.DoesNotExist):
            return []

    @database_sync_to_async
    def save_pushed_question(self, room_code, question, q_type, options, correct_answer):
        room = Room.objects.get(code=room_code)
        room.active_question = question
        room.question_type = q_type
        room.quiz_options = options
        room.question_round += 1
        room.correct_answer = correct_answer
        room.is_revealed = False
        room.save()
        return {'round': room.question_round}

    @database_sync_to_async
    def save_student_answer(self, room_code, student_name, answer_val, round_num):
        room = Room.objects.get(code=room_code)
        student, _ = Student.objects.get_or_create(room=room, name=student_name)
        Answer.objects.create(
            room=room,
            student=student,
            question_round=round_num if round_num > 0 else room.question_round,
            value=answer_val
        )

    @database_sync_to_async
    def set_answer_revealed(self, room_code, correct_answer):
        room = Room.objects.get(code=room_code)
        if correct_answer:
            room.correct_answer = correct_answer
        room.is_revealed = True
        room.save()

    @database_sync_to_async
    def reset_room_round(self, room_code):
        room = Room.objects.get(code=room_code)
        room.active_question = None
        room.quiz_options = []
        room.correct_answer = None
        room.is_revealed = False
        room.save()
        return {'round': room.question_round}

    @database_sync_to_async
    def register_student_join(self, room_code, student_name):
        try:
            room = Room.objects.get(code=room_code)
            Student.objects.get_or_create(room=room, name=student_name)
            students = list(room.students.values_list('name', flat=True))
            approved = list(room.students.filter(is_whiteboard_approved=True).values_list('name', flat=True))
            return {'students': students, 'approved_students': approved}
        except Room.DoesNotExist:
            return {'students': [], 'approved_students': []}
