// script.js
document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.getElementById('contactForm');
    
    // Создаем элемент для вывода сообщений о статусе
    let statusMessage = document.querySelector('.form-status');
    if (!statusMessage) {
        statusMessage = document.createElement('p');
        statusMessage.className = 'form-status';
        contactForm.appendChild(statusMessage);
    }

    contactForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        // ❗️ Вставьте сюда URL, который вам предоставил Vercel
        const VERCEL_URL = 'https://avku-6o1u.vercel.app/api/server';

        statusMessage.textContent = 'Надсилання...';
        statusMessage.style.color = 'blue';

        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            message: document.getElementById('message').value
        };

        try {
            const response = await fetch(VERCEL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                statusMessage.textContent = 'Повідомлення успішно надіслано!';
                statusMessage.style.color = 'green';
                contactForm.reset();
            } else {
                statusMessage.textContent = `Помилка: ${result.error || 'Не вдалось відправити.'}`;
                statusMessage.style.color = 'red';
            }
        } catch (error) {
            statusMessage.textContent = 'Помилка мережі. Спробуйте пізніше.';
            statusMessage.style.color = 'red';
        }
    });
});