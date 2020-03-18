export function push_permission_clicked() {
	const push_button = document.getElementById('push-permissions');
	push_button.removeAttribute('disabled');
	push_button.focus();
	let resolve;
	const handler = _ => {
		push_button.setAttribute('disabled', '');
		push_button.removeEventListener('click', handler);
		resolve();
	}
	push_button.addEventListener('click', handler);
	return new Promise(res => resolve = res);
}
export const self_info = {
	button: document.querySelector('#self-info button'),
	output: document.querySelector('#self-info div')
};

export const make_friend_info = {
	button: document.querySelector('#make-friend button'),
	input: document.querySelector('#make-friend input[type="text"]')
}