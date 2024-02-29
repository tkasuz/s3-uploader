use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use js_sys::{Math::random, Promise};
use web_sys::{Request, RequestInit, RequestMode, Response};
use serde::{Serialize, Deserialize};

const MAX_RETRIES: u8 = 5;
const CHUNK_SIZE: u32 = 5 * 1024 * 1024;
const MAX_NUMBER_OF_CHUNKS: u32 = 6;

async fn sleep(sleep_time: i32){
    let promise = Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, sleep_time)
            .unwrap();
    });
    let _ = JsFuture::from(promise).await;
}

fn get_part_number_from_presigned_url(url: &str) -> Option<i32> {
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
pub fn get_number_of_parts(size: u32) -> Result<JsValue, JsError> {
    let mut divided_by = MAX_NUMBER_OF_CHUNKS;
    if size == 0 {
        return Err(JsError::new(""))
    }
    if size < CHUNK_SIZE {
        return Ok(1.into());
    }
    loop {
        match size / divided_by > CHUNK_SIZE {
            true => break,
            false => divided_by -= 1,
        }
        match divided_by == 1 {
            true => break,
            false => continue,
        }
    }

    divided_by += 1;
    Ok(divided_by.into())
}

#[derive(Serialize, Deserialize)]
pub struct Part {
    pub etag: String,
    pub part_number: i32
}

fn create_request_client(url: &str, data: &[u8]) -> Request {
    let mut opts = RequestInit::new();
    opts.method("PUT");
    opts.mode(RequestMode::Cors);
    opts.body(Some(&JsValue::from_str(
        &String::from_utf8(data.to_vec()).unwrap(),
    )));
    let request = Request::new_with_str_and_init(&url, &opts).unwrap();
    request
        .headers()
        .set("Access-Control-Allow-Credentials", "true")
        .unwrap();
    request
        .headers()
        .set("Access-Control-Expose-Headers", "ETag")
        .unwrap();
    request
}


#[wasm_bindgen]
pub async fn request(url: &str, data: &[u8]) -> Result<JsValue, JsValue>  {
    let mut retries: u8 = 0;
    let part_number = match get_part_number_from_presigned_url(url) {
        Some(part_number) => part_number,
        None => 0
    };
    loop {
        let request = create_request_client(url, data);
        let window = web_sys::window().unwrap();
        let resp_value = match JsFuture::from(window.fetch_with_request(&request)).await {
            Ok(resp_value) => resp_value,
            Err(_) => return Err(part_number.into())
        };
        assert!(resp_value.is_instance_of::<Response>());
        let resp: Response = match resp_value.dyn_into() {
           Ok(resp) => resp,
           Err(_) => return Err(part_number.into())
        };
        let etag = match resp.headers().get("ETag") {
            Ok(etag) => etag,
            Err(_) => return Err(part_number.into())
        };
        let _ = match etag {
           Some(etag) => return Ok(serde_wasm_bindgen::to_value(&Part{part_number, etag}).unwrap()),
           None => ()
        };
        retries += 1;
        if retries > MAX_RETRIES {
           return Err(part_number.into())
        };
        let wait_time = ((retries.pow(2) as f64 + random()) * 1000 as f64) as i32;
        sleep(wait_time).await;
    }
}

#[wasm_bindgen]
pub async fn read(reader: &web_sys::FileReader, file: &web_sys::File, start: i32, end: i32) -> Result<(), JsValue> {
    let blob = file
                .slice_with_i32_and_i32(start, end)
                .unwrap();
    reader.read_as_array_buffer(&blob)
}