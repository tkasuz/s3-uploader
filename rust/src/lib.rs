use wasm_bindgen::prelude::*;
use web_sys::{File, FileReaderSync};

mod utils;

const CHUNK_SIZE: i32 = 5 * 1024 * 1024;

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
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
    let data = byte_array.to_vec();
    let request = utils::create_request_client(url, &data, &file.name(), &file.type_()).unwrap();
    log("request is created");
    let etag = utils::fetch(&request).await;
    log(etag.clone().unwrap().as_str());
    etag
}

#[wasm_bindgen(js_name = getPartNumberFromPresignedUrl)]
pub fn get_part_number_from_presigned_url(url: &str) -> Option<i32> {
    let queries : Vec<&str>= url.split("?").collect();
    let items: Vec<&str> = queries[1].split("&").collect();
    for item in items {
        if item.starts_with("partNumber") {
            let v: Vec<&str> = item.split("=").collect();
            return Some(v[1].parse::<i32>().unwrap());  
        }
    }
    None
}

#[wasm_bindgen]
pub fn get_number_of_parts(size: i32) -> i32 {
    if size <= CHUNK_SIZE {
        return 1
    }
    (size as f32 / CHUNK_SIZE as f32).ceil() as i32
}
