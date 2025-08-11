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

    // Инициализация поведения форм (класс .has-value)
    initFormInputs();
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
                throw new Error("Помилка завантаження файлу перекладу");
            }
            return response.json();
        })
        .then(data => {
            applyTranslations(data);
            document.title = data.page_title || document.title;
            localStorage.setItem("selectedLanguage", lang);
        })
        .catch(error => {
            console.error("Помилка при завантаженні перекладу:", error);
            // Попытка fallback на английский только если текущий язык не 'en'
            if (lang !== 'en') {
                fetch('lang/en.json')
                .then(r => {
                    if (!r.ok) throw new Error('fallback failed');
                    return r.json();
                })
                .then(data => {
                    applyTranslations(data);
                    document.title = data.page_title || document.title;
                    localStorage.setItem("selectedLanguage", 'en');
                })
                .catch(err => {
                    console.error('Не удалось загрузить fallback-переводы:', err);
                    // optionally показать пользователю уведомление или оставить текст по-умолчанию
                });
            }
        });
}

/**
 * Применяет переводы к элементам с атрибутом data-translate.
 * @param {Object} translations - Объект с переводами.
 */
function applyTranslations(translations) {
    document.querySelectorAll("[data-translate]").forEach(elem => {
        const key = elem.getAttribute("data-translate");
        if (Object.prototype.hasOwnProperty.call(translations, key)) {
            // Заменяем неразрывные пробелы на обычные пробелы,
            // можно добавить другие фильтры при необходимости
            const safeHtml = String(translations[key])
                            .replace(/\u00A0/g, ' ')
                            .replace(/&nbsp;/g, ' ');
            elem.innerHTML = safeHtml;
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
    const galleryContainer = document.querySelector('.gallery-container');
    const allItems = galleryContainer
      ? Array.from(galleryContainer.querySelectorAll('.gallery-item'))
      : Array.from(document.querySelectorAll('.gallery-item'));

    if (allItems.length === 0) {
        // очистим пагинацию и вернёмся
        const pagination = document.querySelector('.pagination-inner');
        if (pagination) pagination.innerHTML = '';
        // можно показать сообщение о пустой галерее здесь (опционально)
        return;
    }


    // Фильтруем по activeFilter
    const filteredItems = (activeFilter === 'all') ?
        allItems :
        allItems.filter(item => item.classList.contains(activeFilter));

    // Считаем общее кол-во страниц и корректируем currentPage
    totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

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
    const galleryContainer = document.querySelector('.gallery-container');
    const container = galleryContainer
      ? galleryContainer.querySelector('.pagination-inner')
      : document.querySelector('.pagination-inner');

    if (!container) return; // Если блока пагинации нет

    container.innerHTML = '';

    // Если страниц меньше 2, пагинация не нужна
    if (totalPages <= 1) {
        return;
    }

    // Кнопка "Предыдущая страница"
    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'page-link prev-page';
    prevButton.textContent = '<';
    prevButton.setAttribute('aria-label', 'Попередня сторінка');
    prevButton.disabled = (currentPage === 1);
    prevButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updateGallery();
        }
    });
    container.appendChild(prevButton);

    // ... кнопки номеров ...
    const maxButtons = 5;
    let startPage, endPage;
    if (totalPages <= maxButtons) {
        startPage = 1;
        endPage = totalPages;
    } else {
        const half = Math.floor(maxButtons / 2);
        startPage = currentPage - half;
        endPage = currentPage + half;
        if (startPage < 1) { startPage = 1; endPage = maxButtons; }
        if (endPage > totalPages) { endPage = totalPages; startPage = totalPages - maxButtons + 1; }
    }
    for (let i = startPage; i <= endPage; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `page-link ${i === currentPage ? 'active' : ''}`;
        button.textContent = i;
        if (i === currentPage) button.setAttribute('aria-current', 'page');
        button.setAttribute('aria-label', `Сторінка ${i}`);
        button.addEventListener('click', () => {
            currentPage = i;
            updateGallery();
        });
        container.appendChild(button);
    }

    // Кнопка "Следующая страница"
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'page-link next-page';
    nextButton.textContent = '>';
    nextButton.setAttribute('aria-label', 'Наступна сторінка');
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

    if (!modalImg) {
        console.error('gallery modal: #modal-image not found — modal disabled');
        return;
    }
    // modalCaption можно оставить опциональным; при отсутствии используем пустую строку



    let lastFocusedElement = null;
    // Открытие модального окна по клику на изображение
    // Делегируем клик по изображению через контейнер галереи (работает для динамических элементов)
    const galleryContainer = document.querySelector('.gallery-container') || document;
    galleryContainer.addEventListener('click', (e) => {
        const img = (e.target instanceof Element) ? e.target.closest('.gallery-item img') : null;

        if (!img) return;
        lastFocusedElement = document.activeElement;
        modal.style.display = 'block';
        // Используйте data-full для полноразмерного изображения, если доступно, иначе src
        modalImg.src = img.dataset.full || img.src;
        const fig = img.closest('figure');
        modalCaption.textContent = fig && fig.querySelector('figcaption') ? fig.querySelector('figcaption').textContent : '';
        if (modalClose) modalClose.focus();
        document.body.style.overflow = 'hidden';
    });

    // Закрытие модального окна по клику вне изображения — корректно восстанавливаем состояние
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modalImg.src = '';
            document.body.style.overflow = '';
            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                lastFocusedElement.focus();
            }
        }
    });

    // Закрытие по клавише Escape
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            modal.style.display = 'none';
            modalImg.src = '';
            document.body.style.overflow = '';
            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                lastFocusedElement.focus();
            }
        }
    });


    // Закрытие модального окна по клику на крестик
    if (modalClose) {
        modalClose.addEventListener('click', () => {
            modal.style.display = 'none';
            lastFocusedElement?.focus();
            document.body.style.overflow = '';
        });
    }
    
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
    function debounce(fn, wait = 250) {
        let t;
        return function(...args) {
            const ctx = this;
            clearTimeout(t);
            t = setTimeout(() => fn.apply(ctx, args), wait);
        };
    }


    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            const searchTerm = (this.value || '').trim().toLowerCase();
            publications.forEach(publication => {
                const title = publication.querySelector('.publication-title')?.textContent?.toLowerCase() || '';
                const description = publication.querySelector('.publication-description')?.textContent?.toLowerCase() || '';
                const isVisible = title.includes(searchTerm) || description.includes(searchTerm);
                publication.style.display = isVisible ? '' : 'none';
            });
        }, 250));
    }

    
    // --- Функционал просмотра PDF ---
    const modal = document.getElementById('pdfPreviewModal');
    if (modal) {
        const pdfViewer = modal.querySelector('#pdfViewer');

        const modalTitle = document.getElementById('pdfModalTitle');
        const downloadBtn = document.getElementById('downloadPdfBtn');
        const closeBtn = document.getElementById('closePdfModal');
        const previewButtons = publicationsContainer.querySelectorAll('.publication-preview-btn');
        let currentPdfUrl = ''; // Храним текущий URL для скачивания

        const onKeyUp = (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            closeModal();
        }
        };

        const closeModal = () => {
        modal.style.display = 'none';
        pdfViewer.src = ''; // Очищаем src, чтобы остановить загрузку PDF
        document.body.style.overflow = '';
        document.removeEventListener('keyup', onKeyUp);
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
                if (!currentPdfUrl) return;
                const tempLink = document.createElement('a');
                tempLink.href = currentPdfUrl;
                const filename = new URL(currentPdfUrl, window.location.href).pathname.split('/').pop() || 'file.pdf';
                tempLink.download = filename;
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
        // Закрытие по Escape
        document.addEventListener('keyup', onKeyUp);
    }


    // --- Инициализация фильтров из URL ---
    const initializeFilters = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const categoryParam = urlParams.get('category');
        if (categoryParam) {
            const targetButton = publicationsContainer.querySelector(`.filter-btn[data-filter="${categoryParam}"]`);
            if (targetButton) {
                targetButton.click();
            }
        }
    };
    initializeFilters();
}


// для управления классом .has-value.
function initFormInputs() {
  const controls = document.querySelectorAll('.form-group input, .form-group textarea, .form-group select');
  controls.forEach(control => {
    const group = control.closest('.form-group');
    if (!group) return;

    const check = () => {
      const val = control.value;
      if (val !== null && String(val).trim() !== '') group.classList.add('has-value');
      else group.classList.remove('has-value');
    };

    // Проверяем при загрузке
    check();

    // Реагируем на ввод и blur (для удобства)
    control.addEventListener('input', check);
    control.addEventListener('blur', check);
  });
}
