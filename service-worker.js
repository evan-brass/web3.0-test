self.onmessage = console.log;
self.onpush = e => {
	console.log(e);
	console.log(e.data.text());
}