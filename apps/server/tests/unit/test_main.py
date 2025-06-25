from unittest.mock import Mock

import main
from env.config import Settings


def test_default_paths_follow_the_launch_directory(monkeypatch, tmp_path):
    monkeypatch.delenv("UPLOAD_ROOT", raising=False)
    monkeypatch.delenv("WORDNET_ROOT", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = main.build_settings()

    assert settings.upload_root == tmp_path / "uploaded_files"
    assert settings.wordnet_root == tmp_path / "nltk_data"
    assert not settings.upload_root.exists()
    assert not settings.wordnet_root.exists()


def test_environment_paths_can_live_outside_the_launch_directory(
    monkeypatch, tmp_path
):
    launch_directory = tmp_path / "service"
    launch_directory.mkdir()
    upload_root = tmp_path / "data" / "uploads"
    wordnet_root = tmp_path / "resources" / "wordnet"
    monkeypatch.setenv("UPLOAD_ROOT", str(upload_root))
    monkeypatch.setenv("WORDNET_ROOT", str(wordnet_root))
    monkeypatch.chdir(launch_directory)

    settings = main.build_settings()

    assert settings.upload_root == upload_root
    assert settings.wordnet_root == wordnet_root


def test_explicit_settings_are_passed_to_the_application_dependencies(
    monkeypatch, tmp_path
):
    settings = Settings(
        upload_root=tmp_path / "uploads",
        wordnet_root=tmp_path / "wordnet",
        allowed_origins=("https://example.test",),
    )
    environment_settings = Mock(side_effect=AssertionError("Unexpected environment read"))
    storage_factory = Mock()
    inference_factory = Mock()
    server_factory = Mock()
    monkeypatch.setattr(main, "build_settings", environment_settings)
    monkeypatch.setattr(main, "FilesystemDocumentStorageTool", storage_factory)
    monkeypatch.setattr(main, "build_infer_schema", inference_factory)
    monkeypatch.setattr(main, "create_http_server", server_factory)

    application = main.create_app(settings=settings)

    environment_settings.assert_not_called()
    storage_factory.assert_called_once_with(settings.upload_root)
    inference_factory.assert_called_once_with(settings)
    assert server_factory.call_args.kwargs["allowed_origins"] == settings.allowed_origins
    assert application is server_factory.return_value
