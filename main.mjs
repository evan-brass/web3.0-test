import service_worker_api from './rpc-client.mjs';

import mount from './extern/js-min/src/templating/mount.mjs';
import html from './extern/js-min/src/templating/html.mjs';
import css from './extern/js-min/src/templating/css.mjs';
import on from './extern/js-min/src/templating/users/on.mjs';

import Base from './extern/js-min/src/custom-elements/base.mjs';

import wrap_signal from './extern/js-min/src/cancellation/wrap-signal.mjs';

import NEVER from './extern/js-min/src/lib/never.mjs';
import delay from './extern/js-min/src/lib/delay.mjs';

import initialized from './init.mjs';

import differed from './extern/js-min/src/lib/differed.mjs';

import create_spinner from './ui/spinner.mjs';

class Web3Friends extends Base {
	async run(signal) {
		const wrap = wrap_signal(signal);

		mount(css`
			:host {
				display: inline-block;
			}
		`, this.shadowRoot);
		
		const spinner = create_spinner();
		const unmount = mount(spinner, this.shadowRoot);

		spinner.run('Initializing...');
		try {
			await wrap(initialized);
		} catch {
			spinner.error('Failed.');
			await wrap(NEVER);
		} finally {
			spinner.complete('Initialized.');
		}
	}
}

customElements.define('web3-friends', Web3Friends);