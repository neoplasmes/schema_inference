import json
import logging
import logging.config

from env.config import build_log_config


def test_production_logs_are_json_lines(capsys):
    logging.config.dictConfig(build_log_config("production"))

    logging.getLogger("schema").warning("analysis %s failed", "a-1")

    record = json.loads(capsys.readouterr().out.strip().splitlines()[-1])

    assert record["level"] == "WARNING"
    assert record["name"] == "schema"
    assert record["message"] == "analysis a-1 failed"
    assert "time" in record


def test_production_logs_drop_uvicorn_terminal_colors(capsys):
    logging.config.dictConfig(build_log_config("production"))

    logging.getLogger("uvicorn.error").info(
        "started", extra={"color_message": "\x1b[36mstarted\x1b[0m"}
    )

    record = json.loads(capsys.readouterr().out.strip().splitlines()[-1])

    assert "color_message" not in record


def test_development_logs_are_plain_text(capsys):
    logging.config.dictConfig(build_log_config("development"))

    logging.getLogger("schema").info("ready")

    line = capsys.readouterr().out.strip().splitlines()[-1]

    assert line.endswith("schema: ready")
