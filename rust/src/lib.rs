use wasm_bindgen::prelude::*;
use web_sys::{File, FileReaderSync};

mod utils;


#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub async fn upload(
    file: File, 
    url: &str,
    start: i32, 
    end: i32,
) -> Option<String> {
    let reader = FileReaderSync::new().unwrap();
    let blob = file
                .slice_with_i32_and_i32(start, end)
                .unwrap();
    let array_buffer = reader.read_as_array_buffer(&blob).unwrap();
    let byte_array  = js_sys::Uint8Array::new(&array_buffer);
    let request = utils::create_upload_part_request(url, &byte_array).unwrap();
    let etag = utils::fetch(&request).await;
    etag
}
