use rand::{
	SeedableRng,
	rngs::StdRng
};
use anyhow::{ Context, anyhow };

fn fill_slice_with_random(dest: &mut [u8]) -> Result<(), anyhow::Error> {
	let window = web_sys::window().context("No Window")?;
	let crypto = window.crypto().map_err(|_| anyhow!("Failed to get crypto off of window."))?;
	crypto.get_random_values_with_u8_array(dest).map_err(|_| anyhow!("Failed to get random bytes."))?;
	Ok(())
}

fn get_crypto_seed() -> Result<[u8; 32], anyhow::Error> {
	let mut seed = [0; 32];
	fill_slice_with_random(&mut seed)?;
	Ok(seed)
}

pub fn get_salt() -> Result<[u8; 16], anyhow::Error> {
	let mut salt = [0; 16];
	fill_slice_with_random(&mut salt)?;
	Ok(salt)
}

pub fn get_rng() -> StdRng {
	let seed = get_crypto_seed().unwrap_or_else(|e| {
		eprintln!("Using default seed for random number generator because something went wrong with window.crypto.getRandomValues! {}", e);

		[42, 165, 163, 27, 236, 71, 63, 27, 75, 254, 24, 180, 80, 8, 105, 120, 14, 55, 14, 236, 68, 38, 100, 45, 194, 36, 110, 30, 128, 83, 190, 19]
	});
	StdRng::from_seed(seed)
}

