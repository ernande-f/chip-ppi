/**
 * Modal de Informações do CHIP com Carrossel de 3 Slides
 */

const SLIDES_DATA = [
    {
        image: '../assets/info-chip.png',
        alt: 'Ilustração de microchip CHIP',
        title: 'O que é o CHIP?',
        text: '<strong>CHIP</strong> é o sistema de empréstimos dos itens do laboratório de Hardware do Instituto Federal Farroupilha - Campus Frederico Westphalen.'
    },
    {
        image: '../assets/info-pedidos.png',
        alt: 'Ilustração de SSD para pedidos e empréstimos',
        title: 'Pedidos e empréstimos',
        text: 'Com o <strong>CHIP</strong>, você pode fazer pedidos diretos com os professores e responsáveis, assim possibilitando o desenvolvimento de projetos.'
    },
    {
        image: '../assets/info-ppi.png',
        alt: 'Ilustração da fonte de alimentação PPI',
        title: 'Prática Profissional Integrada',
        text: 'Esse projeto foi desenvolvido para a PPI (Prática Profissional Integrada) do ano de 2025/26, por alunos do 2º ano do técnico integrado em informática.'
    }
];

let currentSlide = 0;
let modalOverlay = null;

function createModalHtml() {
    if (document.getElementById('infoModalOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'infoModalOverlay';
    overlay.className = 'info-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Informações sobre o CHIP');

    overlay.innerHTML = `
        <div class="info-modal-card">
            <div class="info-modal-top">
                <span class="info-modal-badge" aria-hidden="true">i</span>
                <button type="button" class="info-modal-close" id="infoModalClose" aria-label="Fechar">&times;</button>
            </div>

            <div class="info-carousel-container" id="infoCarouselContainer">
                ${SLIDES_DATA.map((slide, index) => `
                    <div class="info-slide ${index === 0 ? 'active' : ''}" data-slide-index="${index}">
                        <div class="info-slide-img-wrapper">
                            <img src="${slide.image}" alt="${slide.alt}" class="info-slide-img">
                        </div>
                        <h2 class="info-slide-title">${slide.title}</h2>
                        <p class="info-slide-text">${slide.text}</p>
                    </div>
                `).join('')}
            </div>

            <div class="info-dots-wrapper" id="infoDotsWrapper">
                ${SLIDES_DATA.map((_, index) => `
                    <span class="info-dot ${index === 0 ? 'active' : ''}" data-dot-index="${index}" role="button" aria-label="Ir para slide ${index + 1}"></span>
                `).join('')}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    modalOverlay = overlay;

    // Eventos de fechamento
    document.getElementById('infoModalClose')?.addEventListener('click', closeInfoModal);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeInfoModal();
    });

    // Eventos dos dots
    const dots = overlay.querySelectorAll('.info-dot');
    dots.forEach((dot) => {
        dot.addEventListener('click', () => {
            const targetIndex = parseInt(dot.getAttribute('data-dot-index'), 10);
            goToSlide(targetIndex);
        });
    });

    // Suporte a gestos touch (swipe)
    let touchStartX = 0;
    let touchEndX = 0;
    overlay.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 40) {
            goToSlide((currentSlide + 1) % SLIDES_DATA.length);
        } else if (touchEndX - touchStartX > 40) {
            goToSlide((currentSlide - 1 + SLIDES_DATA.length) % SLIDES_DATA.length);
        }
    }, { passive: true });
}

function goToSlide(index) {
    currentSlide = index;
    const slides = document.querySelectorAll('.info-slide');
    const dots = document.querySelectorAll('.info-dot');

    slides.forEach((slide, idx) => {
        slide.classList.toggle('active', idx === currentSlide);
    });

    dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentSlide);
    });
}

export function openInfoModal() {
    createModalHtml();
    goToSlide(0);
    if (modalOverlay) {
        modalOverlay.style.display = 'flex';
    }
}

export function closeInfoModal() {
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
    }
}

// Tecla ESC e setas
document.addEventListener('keydown', (event) => {
    if (!modalOverlay || modalOverlay.style.display !== 'flex') return;

    if (event.key === 'Escape') {
        closeInfoModal();
    } else if (event.key === 'ArrowRight') {
        goToSlide((currentSlide + 1) % SLIDES_DATA.length);
    } else if (event.key === 'ArrowLeft') {
        goToSlide((currentSlide - 1 + SLIDES_DATA.length) % SLIDES_DATA.length);
    }
});

// Inicialização automática ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    createModalHtml();

    const infoTriggers = document.querySelectorAll('.info-button, #infoButton, .fa-circle-question');
    infoTriggers.forEach((trigger) => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            openInfoModal();
        });
    });
});
