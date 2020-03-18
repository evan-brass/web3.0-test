// Stolen from https://github.com/mozilla-services/WebPushDataTestPage/blob/gh-pages/common.js
export function toUrlBase64(data) {
	/* Convert a binary array into a URL safe base64 string
	*/
	return btoa(data)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "")
}
export function strToArray(str) {
	/* convert a string into a ByteArray
	 *
	 * TextEncoders would be faster, but have a habit of altering
	 * byte order
	 */
	let split = str.split("");
	let reply = new Uint8Array(split.length);
	for (let i in split) {
		reply[i] = split[i].charCodeAt(0);
	}
	return reply;
}
export function arrayToStr(array) {
	/* convert a ByteArray into a string
	 */
	return String.fromCharCode.apply(null, new Uint8Array(array));
}