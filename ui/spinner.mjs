import ref from '../extern/js-min/src/templating/users/ref.mjs';
import User from '../extern/js-min/src/templating/users/user.mjs';
import html from '../extern/js-min/src/templating/html.mjs';
import css from '../extern/js-min/src/templating/css.mjs';

import LiveData from '../extern/js-min/src/reactivity/live-data.mjs';


export default function create_spinner() {
	let state = new LiveData('dormant');
	let status = new LiveData('');
	return {
		dormant() {
			state.value = 'dormant';
			status.value = '';
		},
		run(status_in = '') {
			state.value = 'running';
			status.value = status_in;
		},
		error(status_in = '') {
			state.value = 'errored';
			status.value = status_in;
		},
		complete(status_in = '') {
			state.value = 'completed';
			status.value = status_in;
		},
		get [User]() {
			return html`
				${css`@import url("./css/spinner.css");`}
				<output class="spinner" ${ref(async (spinner, signal) => {
					const classes = ['dormant', 'running', 'errored', 'completed'];
					for await (const s of state) {
						if (signal.aborted) return;
						spinner.classList.remove(...classes);
						spinner.classList.add(s);
					}
				})}>
					<span></span>
					${status}
				<output>
			`;
		}
	};
}