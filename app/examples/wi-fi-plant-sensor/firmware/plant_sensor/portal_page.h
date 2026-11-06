// The setup page the sensor serves on its own Wi-Fi (Formery-Plant-XXXX, http://192.168.4.1/).
// Kept in a .h file so the Arduino IDE's sketch preprocessor never has to parse the raw strings.
#pragma once

static const char PAGE_TOP[] = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up your plant sensor</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f6f5f2;color:#1c1b19;font:17px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
main{max-width:460px;margin:0 auto;padding:24px 16px 40px}
h1{font-size:26px;line-height:1.2;margin:4px 0 8px}
p{margin:0 0 16px;color:#57534e}
.card{background:#fff;border-radius:20px;padding:18px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
label{display:block;font-weight:600;margin:0 0 6px}
label+.hint{margin:-4px 0 8px;font-size:15px;color:#6b6560}
input,select{width:100%;font:inherit;font-size:17px;min-height:48px;padding:10px 12px;border:1px solid #d6d3d1;border-radius:12px;background:#fff;color:inherit;margin-bottom:16px}
select{-webkit-appearance:none;appearance:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%2378716c' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 14px center;padding-right:36px}
input[type=file]{padding:12px;min-height:52px}
input:focus,select:focus{outline:2px solid #2f7d4f;outline-offset:1px;border-color:#2f7d4f}
button{width:100%;min-height:52px;font:inherit;font-weight:600;border:0;border-radius:14px;background:#2f7d4f;color:#fff}
button:active{background:#25643f}
.err{background:#fdecea;color:#8a1c12;border-radius:14px;padding:12px 14px;margin-bottom:16px}
.ok{background:#e8f3ec;color:#1d5a35;border-radius:14px;padding:12px 14px;margin-bottom:16px}
.small{font-size:15px;color:#6b6560}
details{margin-bottom:16px}
a{color:#2f7d4f}
.spin{width:28px;height:28px;border:3px solid #d6d3d1;border-top-color:#2f7d4f;border-radius:50%;animation:s 0.9s linear infinite;margin:4px 0 12px}
@keyframes s{to{transform:rotate(360deg)}}
[hidden]{display:none!important}
summary{min-height:44px;display:flex;align-items:center;font-weight:600;cursor:pointer}
</style></head><body><main>
)HTML";

static const char PAGE_BOTTOM[] = R"HTML(</main></body></html>
)HTML";
