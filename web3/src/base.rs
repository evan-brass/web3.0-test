use wasm_bindgen::prelude::*;
use std::io;

use wee_alloc;
use console_error_panic_hook;


#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;


#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_namespace = console, js_name = log)]
	fn console_log(msg: &str);
	#[wasm_bindgen(js_namespace = console, js_name = error)]
	fn console_error(msg: &str);
}
pub fn init() {
	console_error_panic_hook::set_once();
	std::io::set_panic(Some(Box::new(StdErr::new())));
	std::io::set_print(Some(Box::new(StdOut::new())));
}

struct StdOut{
	buffer: String
}
impl StdOut {
	pub fn new() -> Self {
		Self {
			buffer: String::new()
		}
	}
}
impl io::Write for StdOut {
	fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
		let str = std::str::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
		self.buffer.push_str(str);
		if self.buffer.ends_with('\n') {
			self.flush()?;
		}
		Ok(buf.len())
	}
	fn flush(&mut self) -> io::Result<()> {
		console_log(self.buffer.as_str());
		self.buffer.clear();
		Ok(())
	}
}
struct StdErr {
	buffer: String
}
impl StdErr {
	pub fn new() -> Self {
		Self {
			buffer: String::new()
		}
	}
}
impl io::Write for StdErr {
	fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
		let str = std::str::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
		self.buffer.push_str(str);
		if self.buffer.ends_with('\n') {
			self.flush()?;
		}
		Ok(buf.len())
	}
	fn flush(&mut self) -> io::Result<()> {
		console_error(self.buffer.as_str());
		self.buffer.clear();
		Ok(())
	}
}