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