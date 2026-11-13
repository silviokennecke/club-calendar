#!/usr/bin/env python3
"""Supervisor event listener: end the container when a critical program dies.

php-fpm and caddy are not restarted (an orchestrator restarts the container); any program
that ends FATAL (start retries used up) is just as fatal. Workers and the scheduler that exit
normally are restarted by supervisord itself (autorestart).
"""
import os
import signal
import subprocess
import sys

from supervisor import childutils

CRITICAL = {"php-fpm", "caddy"}
CONF = "/tmp/supervisor/supervisord.conf"
PIDFILE = "/tmp/supervisor/supervisord.pid"


def log(msg):
    sys.stderr.write("[crash-guard] %s\n" % msg)
    sys.stderr.flush()


def terminate(reason):
    log("%s: stopping all programs, container will exit" % reason)
    try:
        out = subprocess.run(["supervisorctl", "-c", CONF, "status"], capture_output=True, text=True, timeout=10).stdout
        names = [l.split()[0] for l in out.splitlines() if l.split() and not l.startswith("crash-guard")]
        if names:
            subprocess.run(["supervisorctl", "-c", CONF, "stop"] + names, timeout=90, stdout=subprocess.DEVNULL)
    except Exception as e:  # best effort, the kill below is what counts
        log("graceful stop failed: %s" % e)
    # SIGKILL on purpose: supervisord would exit 0 on SIGTERM, the container must end non-zero
    os.kill(int(open(PIDFILE).read().strip()), signal.SIGKILL)


def main():
    while True:
        headers, payload = childutils.listener.wait(sys.stdin, sys.stdout)
        data = dict(x.split(":") for x in payload.split())
        name = data.get("processname", "")
        group = data.get("groupname", "")
        if headers["eventname"] == "PROCESS_STATE_FATAL":
            terminate("%s:%s entered FATAL" % (group, name))
        elif name in CRITICAL:
            terminate("%s exited (expected=%s)" % (name, data.get("expected")))
        childutils.listener.ok(sys.stdout)


if __name__ == "__main__":
    main()
