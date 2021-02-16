use wee_alloc;
use console_error_panic_hook;


#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;


pub fn init() {
	console_error_panic_hook::set_once();
}