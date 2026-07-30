#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Tracks whether windows are currently capturable (content protection off).
/// `false` means protected — the normal, shipped behaviour.
static CAPTURE_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Dev escape hatch: when `PLUELY_CAPTURABLE=1` is set, windows are made
/// visible to screen capture / screenshots so the overlay can be recorded or
/// screenshotted while developing. Never enabled in release builds.
pub fn capture_visible_requested() -> bool {
    cfg!(debug_assertions)
        && matches!(
            std::env::var("PLUELY_CAPTURABLE").as_deref(),
            Ok("1") | Ok("true")
        )
}

/// Rewrites the window configs from `tauri.conf.json` so that windows are built
/// *unprotected* from the start when the dev flag is set.
///
/// This must happen before any window exists. Flipping content protection after
/// a window has been created changes the window's display affinity underneath
/// WebView2, which drops its composition surface and leaves the window blank on
/// Windows — hence doing it at config time instead.
pub fn apply_dev_capture_config<R: Runtime>(context: &mut tauri::Context<R>) {
    if !capture_visible_requested() {
        return;
    }

    CAPTURE_VISIBLE.store(true, std::sync::atomic::Ordering::Relaxed);
    for window in context.config_mut().app.windows.iter_mut() {
        window.content_protected = false;
    }
    eprintln!("[dev] Content protection DISABLED at startup (PLUELY_CAPTURABLE)");
}

/// Whether windows should be created capturable, for windows built in code
/// rather than declared in `tauri.conf.json`.
pub fn dev_capture_content_protected() -> bool {
    !CAPTURE_VISIBLE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Returns whether windows are currently visible to screen capture.
#[tauri::command]
pub fn get_capture_visible() -> bool {
    CAPTURE_VISIBLE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("pluely"))
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    // On Windows, mark the overlay as a tool window so the process is listed
    // under "Background processes" (not "Apps") in Task Manager, even while the
    // overlay is visible.
    #[cfg(target_os = "windows")]
    set_tool_window(&window);

    // Set window as non-focusable on Windows
    // #[cfg(target_os = "windows")]
    // {
    //     let _ = window.set_focusable(false);
    // }

    Ok(())
}

/// Marks a window as a Windows "tool window" (`WS_EX_TOOLWINDOW`) and clears the
/// "app window" style (`WS_EX_APPWINDOW`). Tool windows are excluded from the
/// taskbar, the Alt+Tab switcher, and—critically—Task Manager's "Apps" group,
/// so the process is reported under "Background processes" instead.
///
/// Only meaningful on 64-bit Windows (the only Windows target Tauri builds for).
#[cfg(target_os = "windows")]
pub fn set_tool_window<R: Runtime>(window: &WebviewWindow<R>) {
    use std::ffi::c_void;

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_APPWINDOW: isize = 0x0004_0000;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, new: isize) -> isize;
    }

    let hwnd = match window.hwnd() {
        Ok(handle) => handle.0 as *mut c_void,
        Err(e) => {
            eprintln!("Failed to get HWND for tool-window styling: {}", e);
            return;
        }
    };

    unsafe {
        let mut ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        ex_style |= WS_EX_TOOLWINDOW;
        ex_style &= !WS_EX_APPWINDOW;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style);
    }
}

/// Positions a window at the top center of the screen with a specified Y offset
pub fn position_window_top_center(
    window: &WebviewWindow,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        // Calculate center X position
        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;

        // Set the window position
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: y_offset,
        }))?;
    }

    Ok(())
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_window_height(window: tauri::WebviewWindow, height: u32) -> Result<(), String> {
    use tauri::{LogicalSize, Size};

    // Simply set the window size with fixed width and new height
    let new_size = LogicalSize::new(600.0, height as f64);
    window
        .set_size(Size::Logical(new_size))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                // Window is hidden, show and focus it
                dashboard_window
                    .show()
                    .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
                dashboard_window
                    .set_focus()
                    .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()));

    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .title("Pluely - Dashboard")
        .center()
        .decorations(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .content_protected(dev_capture_content_protected())
        .visible(true)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    #[cfg(not(target_os = "macos"))]
    let base_builder = base_builder
        .title("Pluely - Dashboard")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(dev_capture_content_protected())
        // Run as a background/tray app: no taskbar button. The window is reached
        // via the tray menu or the toggle-dashboard shortcut.
        .skip_taskbar(true)
        .visible(false);

    let window = base_builder.build()?;

    // On Windows, keep the process classified under "Background processes" in
    // Task Manager even when the dashboard is open.
    #[cfg(target_os = "windows")]
    set_tool_window(&window);

    // Set up close event handler - hide window instead of destroying it
    setup_dashboard_close_handler(&window);

    Ok(window)
}

/// Sets up the close event handler for the dashboard window
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
        }
    });
}

/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        // Window exists, show and focus it
        dashboard_window
            .show()
            .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
        dashboard_window
            .set_focus()
            .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    } else {
        // Window doesn't exist, create it and then show it
        let window = create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?;
        window
            .show()
            .map_err(|e| format!("Failed to show new dashboard window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus new dashboard window: {}", e))?;
    }
    Ok(())
}

/// Saved overlay window geometry so fullscreen can be restored to the exact
/// pre-fullscreen position and size.
#[derive(Default)]
pub struct OverlayFullscreenState {
    pub(crate) saved: std::sync::Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
}

/// Expand the main overlay window to the current monitor's work area
/// (taskbar/menubar stay visible), or restore it to the saved geometry.
#[tauri::command]
pub fn set_overlay_fullscreen(
    window: tauri::WebviewWindow,
    state: tauri::State<OverlayFullscreenState>,
    enabled: bool,
) -> Result<(), String> {
    use tauri::{Position, Size};

    if enabled {
        let pos = window
            .outer_position()
            .map_err(|e| format!("Failed to read window position: {}", e))?;
        let size = window
            .outer_size()
            .map_err(|e| format!("Failed to read window size: {}", e))?;
        {
            let mut saved = match state.saved.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            *saved = Some((pos, size));
        }

        let monitor = window
            .current_monitor()
            .map_err(|e| format!("Failed to get current monitor: {}", e))?
            .ok_or_else(|| "No current monitor available".to_string())?;
        let area = monitor.work_area();

        window
            .set_size(Size::Physical(area.size))
            .map_err(|e| format!("Failed to resize fullscreen window: {}", e))?;
        window
            .set_position(Position::Physical(area.position))
            .map_err(|e| format!("Failed to position fullscreen window: {}", e))?;
    } else {
        let saved = {
            let mut guard = match state.saved.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.take()
        };
        if let Some((pos, size)) = saved {
            window
                .set_size(Size::Physical(size))
                .map_err(|e| format!("Failed to restore window size: {}", e))?;
            window
                .set_position(Position::Physical(pos))
                .map_err(|e| format!("Failed to restore window position: {}", e))?;
        }
    }

    Ok(())
}
