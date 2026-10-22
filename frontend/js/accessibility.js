let preference;
try { preference = localStorage.getItem('chip-contrast'); } catch { /* Armazenamento pode estar desativado no navegador. */ }
const systemContrast = matchMedia('(prefers-contrast: more)');

function applyContrast() {
    const high = preference ? preference === 'high' : systemContrast.matches;
    document.documentElement.dataset.contrast = high ? 'high' : 'normal';
    document.getElementById('contrastToggle')?.setAttribute('aria-pressed', String(high));
}
applyContrast();
systemContrast.addEventListener('change', applyContrast);

export function createContrastButton() {
    const button = document.createElement('button');
    button.id = 'contrastToggle';
    button.className = 'chip-contrast';
    button.type = 'button';
    button.textContent = 'Alto contraste';
    button.setAttribute('aria-pressed', String(document.documentElement.dataset.contrast === 'high'));
    button.addEventListener('click', () => {
        preference = document.documentElement.dataset.contrast === 'high' ? 'normal' : 'high';
        try { localStorage.setItem('chip-contrast', preference); } catch { /* Preferência permanece nesta página quando o armazenamento está desativado. */ }
        applyContrast();
    });
    return button;
}
