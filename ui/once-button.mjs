import User from '../extern/js-min/src/templating/users/user.mjs';

export default function once_button(title) {
	let res, rej;
	let ret = new Promise((resolve, reject) => {
		res = resolve;
		rej = reject;
	});

	const btn = document.createElement('button');
	btn.innerText = title;
	btn.onclick = res;

	ret[User] = {
		acceptTypes: new Set(['node']),
		bind(part) {
			part.update(btn);
		},
		unbind(part) {
			part.clear();
		}
	};

	return ret;
}