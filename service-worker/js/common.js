// UTF-8 Text utf8_encoder that's used in a few places
const utf8_encoder = new TextEncoder();
// Decoder, also used at least in signaling-api
const decoder = new TextDecoder('UTF-8', {
	fatal: true
});

const NEVER = new Promise(_ => undefined);

function wrap_request(request, handlers) {
	return new Promise((resolve, reject) => {
		for (const key in handlers) {
			request.addEventListener(key, handlers[key]);
		}
		request.addEventListener('success', _ => resolve(request.result));
		request.addEventListener('error', _ => reject(request.error));
	});
}

function build_buffer(template) {
	const total = template.reduce((acc, item) => 
		acc + (Number.isInteger(item) ? item : item.byteLength),
	0);
	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const item of template) {
		if (!Number.isInteger(item)) {
			buffer.set(item, offset);
			offset += item.byteLength;
		} else {
			offset += item;
		}
	}
	return buffer;
}
