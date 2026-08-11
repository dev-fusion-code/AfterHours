from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from .models import Room, Student

def index_view(request):
    """Landing page to create room as teacher or join room as student."""
    return render(request, 'classroom/index.html')

def create_room_view(request):
    """Creates a new classroom room and redirects to teacher dashboard."""
    if request.method == 'POST':
        title = request.POST.get('title', '').strip() or 'Huddle Session'
        room = Room.objects.create(title=title)
        return redirect('teacher_dashboard', room_code=room.code)
    return redirect('index')

def join_room_view(request):
    """Processes student join request and redirects to student view."""
    if request.method == 'POST':
        code = request.POST.get('room_code', '').strip().upper()
        name = request.POST.get('student_name', '').strip()

        if not code or not name:
            messages.error(request, "Please enter both room code and your name.")
            return redirect('index')

        try:
            room = Room.objects.get(code=code)
            Student.objects.get_or_create(room=room, name=name)
            return redirect(f"/student/{code}/?name={name}")
        except Room.DoesNotExist:
            messages.error(request, f"Room with code '{code}' was not found. Check the code and try again.")
            return redirect('index')

    return redirect('index')

def teacher_dashboard_view(request, room_code):
    """Teacher dashboard page."""
    room = get_object_or_404(Room, code=room_code.upper())
    students = room.students.all().order_by('-joined_at')
    return render(request, 'classroom/teacher.html', {
        'room': room,
        'students': students,
    })

def student_view(request, room_code):
    """Student view page."""
    room = get_object_or_404(Room, code=room_code.upper())
    student_name = request.GET.get('name', '').strip() or 'Student'
    return render(request, 'classroom/student.html', {
        'room': room,
        'student_name': student_name,
    })
