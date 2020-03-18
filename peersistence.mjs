// TODO: Instead of storing keys and peers seperately.

function wrap_request(request, handlers) {
	return new Promise((resolve, reject) => {
		for (const key in handlers) {
			request.addEventListener(key, handlers[key]);
		}
		request.addEventListener('success', ({target}) => resolve(target));
		request.addEventListener('error', reject);
	});
}
const database = wrap_request(indexedDB.open('peersistence', 1), {
	upgradeneeded: ({target, oldVersion}) => {
		const db = target.result;
		if (oldVersion == 0) {
			// This is where we'll store our local keys: CryptoKeyPair's for the application server that we use with our subscription
			db.createObjectStore('keys', { autoIncrement: true });
		}
	}
}).then(({result}) => result);
database.then(console.log);

export async function get_keys() {
	const db = await database;
	let transaction = db.transaction(['keys'], 'readonly');
	let request = transaction.objectStore('keys').openCursor();
	let cursor = (await wrap_request(request)).result;
	const keys = [];
	while (cursor) {
		keys.push(cursor.value);
		cursor.continue();
		cursor = (await wrap_request(request)).result;
	}
	return keys;
}
export async function add_key(key) {
	const db = await database;
	const transaction = db.transaction(['keys'], 'readwrite');
	await wrap_request(transaction.objectStore('keys').add(key));
}