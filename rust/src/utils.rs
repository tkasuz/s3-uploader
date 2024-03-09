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

pub fn create_request_client(url: &str, data: &[u8], filename: &str, content_type: &str) -> Result<Request, JsValue> {
    log(filename);
    log(content_type);
    let mut opts = RequestInit::new();
    opts.method("PUT");
    opts.mode(RequestMode::Cors);
    opts.body(Some(&JsValue::from_str(
        &String::from_utf8_lossy(data),
    )));
    let request = Request::new_with_str_and_init(&url, &opts)?;
    request
        .headers()
        .set("Access-Control-Allow-Credentials", "true")?;
    request
        .headers()
        .set("Access-Control-Expose-Headers", "ETag")?;
    request
        .headers()
        .set("Content-Type", content_type)?;
    request
        .headers()
        .set("Content-Disposition", format!("attachment; filename=\"{}\"", filename).as_str())?;
    log("format");
    Ok(request)
}


pub async fn fetch(request: &Request) -> Option<String>  {
    let mut retries: u8 = 0;
    log("fetch");
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