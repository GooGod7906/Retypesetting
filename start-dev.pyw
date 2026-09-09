# -*- coding: utf-8 -*-
"""
PDF Re-typesetting 一键启动器（静默版，无黑窗口）

替代原有的 start-dev.bat：
- 双击本文件即可静默启动前后端（不会弹出黑色命令行窗口）
- 自动清理 3000 / 5173 端口占用
- 启动后约 10 秒自动打开浏览器 http://localhost:3000
- 启动日志写入同目录下的 start-dev.log（便于排查问题）

注意：
1. 请将本文件放在项目根目录（与 package.json 同级）。
2. 系统需已安装 Python 且 .pyw 关联到 pythonw.exe
   （Python 默认安装会自带此关联；若双击仍弹窗，
    可在命令行用 `pythonw.exe start-dev.pyw` 启动）。
3. 关闭服务：在任务管理器结束 pythonw 进程，或结束占用
   3000/5173 端口的 node 进程。
"""

import os
import time
import threading
import subprocess
import webbrowser
import ctypes

# 项目根目录（取本文件所在目录，确保与 package.json 同级的写法一致）
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(PROJECT_DIR, "start-dev.log")

# Windows 下用于禁止子进程创建控制台窗口的标志
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


def log(msg):
    """将信息写入日志文件（静默运行，无控制台输出）。"""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("[%Y-%m-%d %H:%M:%S] ") + str(msg) + "\n")
    except Exception:
        pass


def show_error(title, text):
    """无控制台环境下用系统消息框提示错误。"""
    try:
        ctypes.windll.user32.MessageBoxW(0, str(text), str(title), 0x10)
    except Exception:
        pass


def kill_ports(ports):
    """通过 PowerShell 关闭占用指定端口的进程（等价于原 bat 的清理逻辑）。"""
    port_list = ",".join(str(p) for p in ports)
    ps = (
        "$pids=(Get-NetTCPConnection -LocalPort {ports} "
        "-ErrorAction SilentlyContinue).OwningProcess|Sort-Object -Unique;"
        "foreach($p in $pids){{if($p){{Stop-Process -Id $p -Force -ErrorAction SilentlyContinue}}}}"
    ).format(ports=port_list)
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as e:
        log("kill_ports error: " + repr(e))


def open_browser_later(url, delay=10):
    """延迟打开浏览器（后台线程执行，不打断主流程）。"""
    time.sleep(delay)
    try:
        webbrowser.open(url)
        log("已打开浏览器：" + url)
    except Exception as e:
        log("打开浏览器失败：" + repr(e))


def check_npm():
    """检查 npm 是否在 PATH 中可用。"""
    try:
        subprocess.run(
            ["npm", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=True,
            creationflags=CREATE_NO_WINDOW,
            check=True,
        )
        return True
    except Exception:
        return False


def main():
    os.chdir(PROJECT_DIR)
    log("=" * 44)
    log(" PDF Re-typesetting - Dev Launcher (pyw 静默版)")
    log(" Backend API : http://localhost:3000")
    log(" Frontend UI : http://localhost:5173")
    log("=" * 44)

    if not check_npm():
        msg = "未找到 npm，请确认 Node.js 已安装并加入系统 PATH。\n\n项目目录：\n" + PROJECT_DIR
        log("npm 不可用，启动中止")
        show_error("启动失败", msg)
        return

    log("正在清理 3000 / 5173 端口占用...")
    kill_ports([3000, 5173])
    time.sleep(2)
    log("端口已清理，准备启动服务...")

    # 后台延迟打开浏览器（对应原 bat 的 timeout 10 + start url）
    threading.Thread(
        target=open_browser_later,
        args=("http://localhost:3000", 10),
        daemon=True,
    ).start()

    # 前台运行 npm run dev（等价于原 bat 的 call npm run dev）
    # 输出重定向到日志文件；CREATE_NO_WINDOW 确保不弹出任何窗口
    log_file = open(LOG_FILE, "a", encoding="utf-8")
    try:
        log("执行：npm run dev")
        subprocess.run(
            "npm run dev",
            cwd=PROJECT_DIR,
            shell=True,
            stdout=log_file,
            stderr=log_file,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as e:
        log("npm run dev 异常：" + repr(e))
        show_error("启动错误", "npm run dev 启动失败：\n" + repr(e))
    finally:
        log_file.close()
        log("启动器已退出。")


if __name__ == "__main__":
    main()
