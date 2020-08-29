// Client <-> Service Worker communication:
const service_worker_messages = {
	unread: [],
	waiting: false
};
navigator.serviceWorker.addEventListener('message', e => {
	service_worker_messages.unread.push(e);
	if (service_worker_messages.waiting) {
		service_worker_messages.waiting();
	}
});
navigator.serviceWorker.startMessages();

export async function fetch_service_worker_message() {
	while (true) {
		if (service_worker_messages.unread.length === 0) {
			let res;
			const prom = new Promise(resolve => res = resolve);
			service_worker_messages.waiting = res;
			await prom;
			service_worker_messages.waiting = false;
		}
		let { data } = service_worker_messages.unread.shift();
		if (data instanceof ArrayBuffer) {
			// TODO: Can probably remove this as well.
			data = new Uint8Array(data);
		}
		if (data instanceof Uint8Array) {
			return data;
		}
	}
}
export async function send_service_worker_message(data) {
	(await navigator.serviceWorker.ready).active.postMessage(data, [data.buffer]);
}