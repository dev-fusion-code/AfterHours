from django.urls import path
from . import views

urlpatterns = [
    path('', views.index_view, name='index'),
    path('create/', views.create_room_view, name='create_room'),
    path('join/', views.join_room_view, name='join_room'),
    path('teacher/<str:room_code>/', views.teacher_dashboard_view, name='teacher_dashboard'),
    path('student/<str:room_code>/', views.student_view, name='student_view'),
]
