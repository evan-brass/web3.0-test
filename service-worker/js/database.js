const DB_VERSION = 1;

function upgradeneeded({target, oldVersion}) {
	const db = target.result;
	if (oldVersion == 0) {
		// This is where we'll store our local keys: CryptoKeyPair's for the application server that we use with our subscription
		const peers_store = db.createObjectStore('peers', { keyPath: 'id', autoIncrement: true });
		peers_store.createIndex('they-are', 'they_are', {
			unique: false,
		});

		// No index 
		const self_store = db.createObjectStore('self', {autoIncrement: true});
	}
}
function get_database(version = DB_VERSION) {
	const open_request = indexedDB.open('peersistence', version);
	open_request.addEventListener('upgradeneeded', upgradeneeded);
	return new Promise((resolve, reject) => {
		open_request.addEventListener('success', _ => resolve(open_request.result));
		open_request.addEventListener('error', _ => reject(open_request.error));
		open_request.addEventListener('blocked', _ =>  reject(open_request.error));
	});
}

// Helper Methods for that interact with the database:
// TODO: Refactor:
async function get_self() {
	const db = await get_database();
	const trans = db.transaction('self', 'readonly');
	const self_store = trans.objectStore('self');

	const self = await wrap_request(self_store.get(0));

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return self;
}
async function put_self(new_self) {
	const db = await get_database();
	const trans = db.transaction('self', 'readwrite');
	const self_store = trans.objectStore('self');

	await wrap_request(self_store.put(new_self, 0));

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();
}
async function get_them(they_are) {
	const db = await get_database();
	const trans = db.transaction('peers', 'readonly');
	const peers_store = trans.objectStore('peers');
	const they_are_index = peers_store.index('they-are');

	const peers = await wrap_request(they_are_index.getAll(they_are));

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return peers;
}
async function get_peers() {
	const db = await get_database();
	const trans = db.transaction('peers', 'readonly');
	const peers_store = trans.objectStore('peers');

	const peers = await wrap_request(peers_store.getAll());

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return peers;
}
async function put_peer(peer) {
	const db = await get_database();
	const trans = db.transaction('peers', 'readwrite');
	const peers_store = trans.objectStore('peers');

	const peer_id = await wrap_request(peers_store.put(peer));

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return peer_id;
}
async function get_peer(id) {
	const db = await get_database();
	const trans = db.transaction('peers', 'readonly');
	const peers_store = trans.objectStore('peers');

	const peer = await wrap_request(peers_store.get(id));

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return peer;
}