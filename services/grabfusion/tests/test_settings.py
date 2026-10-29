from grabfusion.settings import Settings


def test_port_defaults_to_8000():
    assert Settings.from_env({}).port == 8000


def test_port_from_platform_variable():
    assert Settings.from_env({"PORT": "5555"}).port == 5555


def test_explicit_port_wins_over_platform_port():
    assert Settings.from_env({"GRABFUSION_PORT": "9000", "PORT": "5555"}).port == 9000


def test_empty_values_fall_back():
    assert Settings.from_env({"GRABFUSION_PORT": "", "PORT": ""}).port == 8000
