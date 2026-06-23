from launch_backend import parse_args


def test_backend_launcher_accepts_host_and_port_arguments() -> None:
    args = parse_args(["--host", "127.0.0.1", "--port", "8765"])

    assert args.host == "127.0.0.1"
    assert args.port == 8765
