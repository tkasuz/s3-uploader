use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::{Math::random, Promise, WebAssembly::Global};
use web_sys::{Request, RequestInit, RequestMode, Response, Window};

use crate::log;
const MAX_RETRIES: u8 = 5;


async fn sleep(sleep_time: i32){
    let promise = Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, sleep_time)
            .unwrap();
    });
    let _ = JsFuture::from(promise).await;
}


pub fn create_upload_part_request(url: &str, data: &js_sys::Uint8Array) -> Result<Request, JsValue> {
    let mut opts = RequestInit::new();
    opts.method("PUT");
    opts.mode(RequestMode::Cors);
    opts.body(Some(data));
    let request = Request::new_with_str_and_init(&url, &opts)?;
    request
        .headers()
        .set("Access-Control-Allow-Credentials", "true")?;
    request
        .headers()
        .set("Access-Control-Expose-Headers", "ETag")?;
    Ok(request)
}

pub async fn fetch(request: &Request) -> Option<String>  {
    let mut retries: u8 = 0;
    loop {
        let global: Global = js_sys::global().unchecked_into();
        let window: Window = global.unchecked_into();
        
        let resp_value = match JsFuture::from(window.fetch_with_request(request)).await {
            Ok(resp_value) => resp_value,
            Err(err) => return err.as_string()
        };
        assert!(resp_value.is_instance_of::<Response>());
        let resp: Response = match resp_value.dyn_into() {
           Ok(resp) => resp,
           Err(err) => return err.as_string()
        };
        let etag = match resp.headers().get("ETag") {
            Ok(etag) => etag,
            Err(err) => return err.as_string()
        };
        let _ = match etag {
           Some(etag) => return Some(etag),
           None => ()
        };
        retries += 1;
        if retries > MAX_RETRIES {
           return None
        };
        let wait_time = ((retries.pow(2) as f64 + random()) * 1000 as f64) as i32;
        sleep(wait_time).await;
    }
}