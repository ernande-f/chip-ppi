const error = new URLSearchParams(location.search).get('error');
const notice = document.getElementById('loginError');
notice.hidden = error === null;
if (error === 'network') {
    notice.textContent = 'Não foi possível conectar ao Google a tempo. Tente entrar novamente em instantes.';
}
if (error === 'blocked') {
    notice.textContent = 'Esta conta está bloqueada. Consulte a administração do laboratório para conferir o motivo e o prazo de liberação.';
}
