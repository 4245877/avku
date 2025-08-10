/**
 * =================================================================
 * ОСНОВНОЙ ФАЙЛ СКРИПТОВ
 * =================================================================
 * Код сгруппирован по функциональным блокам и инициализируется
 * после полной загрузки DOM.
 */

document.addEventListener("DOMContentLoaded", () => {
    // Инициализация базового функционала (язык, меню)
    initBaseFunctionality();

    // Инициализация галереи (если она есть на странице)
    initGallery();

    // Инициализация модального окна для галереи
    setupModal();

    // Инициализация функционала для страницы публикаций
    initPublicationsPage();
});


/**
 * =================================================================
 * 1. БАЗОВЫЙ ФУНКЦИОНАЛ: ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА И МОБИЛЬНОЕ МЕНЮ
 * =================================================================
 */
function initBaseFunctionality() {
    // Получаем язык из localStorage или устанавливаем "en" по умолчанию
    const savedLang = localStorage.getItem("selectedLanguage") || "en";
    loadLanguage(savedLang);

    // Обработчики для кнопок переключения языка
    document.querySelectorAll(".lang-btn").forEach(button => {
        button.addEventListener("click", () => {
            const lang = button.getAttribute("data-lang");
            loadLanguage(lang);
        });
    });

    // Обработчик для гамбургер-меню
    const hamburger = document.querySelector(".hamburger");
    const navLinks = document.querySelector(".nav-links");
    if (hamburger && navLinks) {
        hamburger.addEventListener("click", () => {
            hamburger.classList.toggle("active");
            navLinks.classList.toggle("active");
        });
    }
}

/**
 * Загружает JSON-файл с переводами для выбранного языка.
 * @param {string} lang - Код языка ("en" или "uk").
 */
function loadLanguage(lang) {
    fetch(`lang/${lang}.json`)
        .then(response => {
            if (!response.ok) {
                throw new Error("Ошибка загрузки файла перевода");
            }
            return response.json();
        })
        .then(data => {
            applyTranslations(data);
            document.title = data.page_title || document.title;
            localStorage.setItem("selectedLanguage", lang);
        })
        .catch(error => {
            console.error("Ошибка при загрузке перевода:", error);
        });
}

/**
 * Применяет переводы к элементам с атрибутом data-translate.
 * @param {Object} translations - Объект с переводами.
 */
function applyTranslations(translations) {
    document.querySelectorAll("[data-translate]").forEach(elem => {
        const key = elem.getAttribute("data-translate");
        if (translations[key]) {
            // Используем innerHTML для поддержки HTML-тегов в переводах
            elem.innerHTML = translations[key];
        }
    });
}


/**
 * =================================================================
 * 2. ЛОГИКА ГАЛЕРЕИ: ФИЛЬТРАЦИЯ + ПАГИНАЦИЯ
 * (Этот раздел не изменялся, только перенесен)
 * =================================================================
 */
// Конфигурация
const itemsPerPage = 16; // Количество фото на странице
let currentPage = 1;
let totalPages = 1;
let activeFilter = 'all';

/**
 * Инициализация галереи:
 * - навешиваем обработчик на кнопки фильтра
 * - запускаем первый рендер
 */
function initGallery() {
    // Проверяем, есть ли на странице контейнер галереи
    if (!document.querySelector('.gallery-container')) return;

    // При клике на кнопку-фильтр:
    document.querySelectorAll('.btn-filter').forEach(button => {
        button.addEventListener('click', () => {
            // Меняем фильтр
            activeFilter = button.dataset.filter;
            // Сбрасываем на первую страницу
            currentPage = 1;
            // Обновляем галерею
            updateGallery();
            // Подсвечиваем активную кнопку
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Первичный рендер
    updateGallery();
}

/**
 * Функция, которая скрывает/показывает элементы исходя из текущего фильтра и пагинации
 */
function updateGallery() {
    const allItems = Array.from(document.querySelectorAll('.gallery-item'));
    if (allItems.length === 0) return;

    // Фильтруем по activeFilter
    const filteredItems = (activeFilter === 'all') ?
        allItems :
        allItems.filter(item => item.classList.contains(activeFilter));

    // Считаем общее кол-во страниц
    totalPages = Math.ceil(filteredItems.length / itemsPerPage);

    // Скрываем все элементы
    allItems.forEach(item => {
        item.style.display = 'none';
    });

    // Показываем элементы текущей страницы
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    filteredItems.slice(start, end).forEach(item => {
        item.style.display = 'block';
    });

    // Генерируем и отрисовываем пагинацию
    renderPagination();
}

function renderPagination() {
    const container = document.querySelector('.pagination-inner');
    if (!container) return; // Если блока пагинации нет

    container.innerHTML = '';

    // Если страниц меньше 2, пагинация не нужна
    if (totalPages <= 1) {
        return;
    }

    // Кнопка "Предыдущая страница"
    const prevButton = document.createElement('button');
    prevButton.className = 'page-link prev-page';
    prevButton.textContent = '<';
    prevButton.disabled = (currentPage === 1);
    prevButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updateGallery();
        }
    });
    container.appendChild(prevButton);

    // Максимальное количество кнопок с номерами страниц
    const maxButtons = 5;
    let startPage, endPage;

    if (totalPages <= maxButtons) {
        startPage = 1;
        endPage = totalPages;
    } else {
        const half = Math.floor(maxButtons / 2);
        startPage = currentPage - half;
        endPage = currentPage + half;

        // Корректировка, если диапазон выходит за пределы допустимых значений
        if (startPage < 1) {
            startPage = 1;
            endPage = maxButtons;
        }
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = totalPages - maxButtons + 1;
        }
    }

    // Кнопки с номерами страниц
    for (let i = startPage; i <= endPage; i++) {
        const button = document.createElement('button');
        button.className = `page-link ${i === currentPage ? 'active' : ''}`;
        button.textContent = i;
        button.addEventListener('click', () => {
            currentPage = i;
            updateGallery();
        });
        container.appendChild(button);
    }

    // Кнопка "Следующая страница"
    const nextButton = document.createElement('button');
    nextButton.className = 'page-link next-page';
    nextButton.textContent = '>';
    nextButton.disabled = (currentPage === totalPages);
    nextButton.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            updateGallery();
        }
    });
    container.appendChild(nextButton);
}


/**
 * =================================================================
 * 3. МОДАЛЬНОЕ ОКНО ДЛЯ ГАЛЕРЕИ (ПРОСМОТР ИЗОБРАЖЕНИЙ)
 * =================================================================
 */
/**
 * Настройка модального окна: навешиваем обработчики кликов на изображения и на кнопку закрытия.
 */
function setupModal() {
    const modal = document.querySelector('.gallery-modal');
    if (!modal) return; // Если модальное окно отсутствует, выходим

    const modalClose = modal.querySelector('.modal-close');
    const modalImg = modal.querySelector('#modal-image');
    const modalCaption = modal.querySelector('.modal-caption');

    // Открытие модального окна по клику на изображение
    document.querySelectorAll('.gallery-item img').forEach(img => {
        img.addEventListener('click', () => {
            modal.style.display = 'block';
            modalImg.src = img.src;
            // Ищем подпись внутри <figure> → <figcaption>, если есть
            const fig = img.closest('figure');
            modalCaption.textContent = fig ?.querySelector('figcaption') ?.textContent || '';
        });
    });

    // Закрытие модального окна по клику на крестик
    if (modalClose) {
        modalClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // Закрытие модального окна по клику вне изображения
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}


/**
 * =================================================================
 * 4. ФУНКЦИОНАЛ ДЛЯ СТРАНИЦЫ ПУБЛИКАЦИЙ
 * =================================================================
 */
function initPublicationsPage() {
    const publicationsContainer = document.querySelector('.publications-container');
    // Если на странице нет контейнера публикаций, прекращаем выполнение функции
    if (!publicationsContainer) {
        return;
    }

    const filterButtons = publicationsContainer.querySelectorAll('.filter-btn');
    const publications = publicationsContainer.querySelectorAll('.publication-card');
    const searchInput = document.getElementById('publicationSearch');

    // --- Фильтрация публикаций по категориям ---
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            const filter = this.dataset.filter;
            publications.forEach(publication => {
                const isVisible = (filter === 'all' || publication.dataset.category === filter);
                publication.style.display = isVisible ? '' : 'none';
            });
        });
    });

    // --- Поиск публикаций по тексту ---
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            publications.forEach(publication => {
                const title = publication.querySelector('.publication-title').textContent.toLowerCase();
                const description = publication.querySelector('.publication-description').textContent.toLowerCase();
                const isVisible = title.includes(searchTerm) || description.includes(searchTerm);
                publication.style.display = isVisible ? '' : 'none';
            });
        });
    }
    
    // --- Функционал просмотра PDF ---
    const modal = document.getElementById('pdfPreviewModal');
    if (modal) {
        const pdfViewer = document.getElementById('pdfViewer');
        const modalTitle = document.getElementById('pdfModalTitle');
        const downloadBtn = document.getElementById('downloadPdfBtn');
        const closeBtn = document.getElementById('closePdfModal');
        const previewButtons = document.querySelectorAll('.publication-preview-btn');
        let currentPdfUrl = ''; // Храним текущий URL для скачивания

        const closeModal = () => {
            modal.style.display = 'none';
            pdfViewer.src = ''; // Очищаем src, чтобы остановить загрузку PDF
            document.body.style.overflow = '';
        };

        // Открытие модального окна
        previewButtons.forEach(button => {
            button.addEventListener('click', function() {
                currentPdfUrl = this.dataset.pdf; // Обновляем URL
                const pdfTitle = this.dataset.title;

                pdfViewer.src = currentPdfUrl;
                modalTitle.textContent = pdfTitle;
                modal.style.display = 'block';
                document.body.style.overflow = 'hidden';
            });
        });

        // Скачивание PDF (один обработчик)
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const tempLink = document.createElement('a');
                tempLink.href = currentPdfUrl;
                tempLink.download = currentPdfUrl.split('/').pop();
                document.body.appendChild(tempLink);
                tempLink.click();
                document.body.removeChild(tempLink);
            });
        }
        
        // Закрытие модального окна
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'block') {
                closeModal();
            }
        });
    }

    // --- Инициализация фильтров из URL ---
    const initializeFilters = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const categoryParam = urlParams.get('category');
        if (categoryParam) {
            const targetButton = document.querySelector(`.filter-btn[data-filter="${categoryParam}"]`);
            if (targetButton) {
                targetButton.click();
            }
        }
    };
    
    initializeFilters();
}






// для управления классом .has-value.

document.querySelectorAll('.form-group input').forEach(input => {
  // Проверяем при загрузке страницы
  if (input.value) {
    input.closest('.form-group').classList.add('has-value');
  }

  // Добавляем обработчики событий
  input.addEventListener('blur', (e) => {
    if (e.target.value) {
      e.target.closest('.form-group').classList.add('has-value');
    } else {
      e.target.closest('.form-group').classList.remove('has-value');
    }
  });
});