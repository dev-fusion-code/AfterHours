import string
import random
from django.db import models

def generate_room_code():
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace('O', '').replace('0', '').replace('I', '').replace('1', '')
    while True:
        code = ''.join(random.choices(chars, k=6))
        if not Room.objects.filter(code=code).exists():
            return code

class Room(models.Model):
    QUESTION_TYPE_CHOICES = (
        ('SHORT_ANSWER', 'Short Answer'),
        ('MULTIPLE_CHOICE', 'Multiple Choice'),
    )

    code = models.CharField(max_length=10, unique=True, default=generate_room_code, db_index=True)
    title = models.CharField(max_length=200, default="Huddle Collaborative Session")
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Active Question / Quiz State
    active_question = models.TextField(blank=True, null=True)
    question_type = models.CharField(max_length=20, choices=QUESTION_TYPE_CHOICES, default='SHORT_ANSWER')
    quiz_options = models.JSONField(default=list, blank=True) # e.g. ["Option A", "Option B", "Option C", "Option D"]
    question_round = models.IntegerField(default=0)
    correct_answer = models.CharField(max_length=250, blank=True, null=True)
    is_revealed = models.BooleanField(default=False)

    # Active Slide / Presentation State
    current_slide_index = models.IntegerField(default=1)
    total_slides = models.IntegerField(default=5)
    slide_title = models.CharField(max_length=200, default="Lecture Presentation")
    slide_data_url = models.TextField(blank=True, null=True)
    canvas_mode = models.CharField(max_length=20, default='pdf') # 'pdf' or 'blank'

    def __str__(self):
        return f"Room {self.code}"

class Student(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='students')
    name = models.CharField(max_length=100)
    is_whiteboard_approved = models.BooleanField(default=False) # Teacher approval for whiteboard collaboration
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('room', 'name')

    def __str__(self):
        return f"{self.name} in Room {self.room.code}"

class Answer(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='answers')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='answers')
    question_round = models.IntegerField(default=0)
    value = models.CharField(max_length=250)
    submitted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Round {self.question_round} - {self.student.name}: {self.value}"

class WhiteboardStroke(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='strokes')
    stroke_data = models.JSONField() # { tool, points, color, width, text, student_name }
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Stroke {self.id} for Room {self.room.code}"

class ChatMessage(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='chat_messages')
    sender_name = models.CharField(max_length=100)
    is_teacher = models.BooleanField(default=False)
    is_private = models.BooleanField(default=False)
    recipient_name = models.CharField(max_length=100, blank=True, null=True)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"[{self.room.code}] {self.sender_name}: {self.message[:30]}"

