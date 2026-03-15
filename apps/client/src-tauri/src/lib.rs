#[cfg(desktop)]
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[derive(serde::Serialize)]
struct CaptureSource {
    id: String,
    name: String,
    #[serde(rename = "sourceType")]
    source_type: String,
    #[serde(rename = "appName")]
    app_name: String,
}

#[cfg(target_os = "windows")]
mod screen_capture {
    use super::CaptureSource;
    use windows::Win32::{
        Foundation::{BOOL, CloseHandle, HWND, LPARAM, RECT, TRUE},
        Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
        System::{
            ProcessStatus::GetModuleBaseNameW,
            Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
            GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
        },
    };

    struct WindowState {
        sources: Vec<CaptureSource>,
        self_pid: u32,
    }

    unsafe extern "system" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut WindowState);

        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return TRUE;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len == 0 {
            return TRUE;
        }

        let mut title_buf = vec![0u16; (title_len + 1) as usize];
        GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if pid == state.self_pid {
            return TRUE;
        }

        let app_name = if pid != 0 {
            match OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) {
                Ok(handle) => {
                    let mut name_buf = vec![0u16; 260];
                    let n = GetModuleBaseNameW(handle, None, &mut name_buf);
                    let _ = CloseHandle(handle);
                    if n > 0 {
                        let raw = String::from_utf16_lossy(&name_buf[..n as usize]);
                        raw.trim_end_matches(".exe").trim_end_matches(".EXE").to_string()
                    } else {
                        String::new()
                    }
                }
                Err(_) => String::new(),
            }
        } else {
            String::new()
        };

        state.sources.push(CaptureSource {
            id: format!("window:{}:0", hwnd.0 as usize),
            name: title,
            source_type: "window".to_string(),
            app_name,
        });

        TRUE
    }

    struct MonitorState {
        sources: Vec<CaptureSource>,
        count: usize,
    }

    unsafe extern "system" fn enum_monitors_cb(
        _hmonitor: HMONITOR,
        _hdc: HDC,
        _lprect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let state = &mut *(lparam.0 as *mut MonitorState);
        let idx = state.count;
        state.count += 1;
        state.sources.push(CaptureSource {
            id: format!("screen:{}:0", idx),
            name: if idx == 0 {
                "Entire Screen".to_string()
            } else {
                format!("Screen {}", idx + 1)
            },
            source_type: "screen".to_string(),
            app_name: String::new(),
        });
        TRUE
    }

    pub fn get_sources() -> Vec<CaptureSource> {
        let mut sources: Vec<CaptureSource> = Vec::new();

        let mut monitor_state = MonitorState { sources: Vec::new(), count: 0 };
        unsafe {
            let ptr = &mut monitor_state as *mut MonitorState as isize;
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(enum_monitors_cb), LPARAM(ptr));
        }
        sources.extend(monitor_state.sources);

        let mut window_state = WindowState {
            sources: Vec::new(),
            self_pid: std::process::id(),
        };
        unsafe {
            let ptr = &mut window_state as *mut WindowState as isize;
            let _ = EnumWindows(Some(enum_windows_cb), LPARAM(ptr));
        }
        sources.extend(window_state.sources);

        sources
    }
}

#[tauri::command]
fn get_capture_sources() -> Vec<CaptureSource> {
    #[cfg(target_os = "windows")]
    {
        screen_capture::get_sources()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![]
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_capture_sources]);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|_app| {
            #[cfg(desktop)]
            let app = _app;
            #[cfg(desktop)]
            {
                let show_item = MenuItem::with_id(app, "show", "Show Gander", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("Gander")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
