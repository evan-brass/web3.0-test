import init, { SelfPeer, PeerList } from '../../wasm/debug/client.js';

async function run() {
	await init();
	console.log("WASM Initialized");

	const self = new SelfPeer();
	console.log(self);
	const peers = new PeerList();
	console.log(peers);
}
run();

// class Web3Friends extends Base {
// 	async run(signal) {
// 		const wrap = wrap_signal(signal);

// 		mount(main_css, this.shadowRoot);

// 		const spinner = create_spinner();
// 		mount(html`
// 			${spinner}
// 			<hr>
// 			<h1>Make Friends</h1>
// 			${(() => {
// 			return html`
// 				<details>
// 					<summary>
// 						Generate your introduction:
// 					</summary>
// 					${(async function*(){
// 						let generate_clicked = differed();
// 						const spinner = create_spinner();
// 						yield html`<button ${on('click', generate_clicked.res)}>Generate</button>`;
// 						while(1) {
// 							await generate_clicked
// 							generate_clicked = differed();
// 							yield spinner;
// 							try {
// 								spinner.run();
// 								const intro = await get_self_introduction();
// 								let intro_out = intro.match(/.{1,30}/g).join('\n');
// 								// let intro_out = intro;
// 								yield html`
// 									<pre style="margin-inline: auto; width: fit-content; inline-size: fit-content;">${intro_out}</pre>
// 									<button ${on('click', generate_clicked.res)}>Regenerate</button>
// 								`;
// 							} catch (e) {
// 								spinner.error();
// 								console.error(e);
// 								yield html`
// 									${spinner}
// 									<button ${on('click', generate_clicked.res)}>Retry</button>
// 								`;
// 							}
// 						}
// 					})()}
// 				</details>
// 			`;
// 			})()}

// 			${(() => {
// 				return html`
// 				<details>
// 					<summary>
// 						Apply a friend's introduction:
// 					</summary>
// 					${(async function* () {
// 						let apply_clicked = differed();
// 						const spinner = create_spinner();
// 						let input_el;
// 						function receive_input() {
// 							return html`
// 								<textarea ${ref(el => input_el = el)}></textarea><br>
// 								<button ${on('click', apply_clicked.res)}>Apply</button>
// 							`;
// 						}
// 						while (1) {
// 							yield receive_input();
// 							await apply_clicked
// 							apply_clicked = differed();

// 							const input = input_el.value;
// 							input_el.value = '';

// 							yield spinner;
// 							const continue_clicked = differed();
// 							try {
// 								spinner.run();
// 								await service_worker_api.apply_introduction(input);
// 								yield html`
// 									Introduction applied.  <button ${on('click', continue_clicked.res)}>Apply Another</button>
// 								`;
// 								await continue_clicked;
// 							} catch (e) {
// 								spinner.error();
// 								console.error(e);
// 								yield html`
// 									${spinner}
// 									<button ${on('click', continue_clicked.res)}>Retry</button>
// 								`;
// 								await continue_clicked;
// 							}
// 						}
// 					})()}
// 				</details>
// 			`;
// 			})()}
// 			<hr>
// 			<h1>Friends:</h1>
// 			<ul>
// 				${(async () => {
// 					const friend_list = new NodeArray();

// 					const updates_port = await service_worker_api.get_peer_list_port();

// 					updates_port.onmessage = ({data}) => {
// 						const peer = new PeerItem(data.id);
// 						friend_list.array.push(html`
// 							<li>${peer}</li>
// 						`);
// 					};

// 					return friend_list;
// 				})()}
// 			</ul>
// 		`, this.shadowRoot);

// 		spinner.run('Initializing...');
// 		try {
// 			await wrap(initialized);
// 		} catch (e) {
// 			spinner.error('Failed.');
// 			throw e;
// 		}
// 		spinner.complete('Initialized.');

// 		// Handle introduction urls:
// 		await (async () => {
// 			if (window.location.hash.slice(0, 8) == '#intros=') {
// 				let introductions;
// 				try {
// 					introductions = JSON.parse(window.location.hash.slice(8));
// 				} catch (e) {
// 					console.warn('Malformed intros: ', e);
// 					return;
// 				}
// 				for (const intro of introductions) {
// 					await service_worker_api.apply_introduction(intro);
// 				}
// 			}
// 		})();


// 		await wrap(NEVER);
// 	}
// }

// customElements.define('web3-friends', Web3Friends);