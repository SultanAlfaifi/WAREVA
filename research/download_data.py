"""Download the public benchmark data from its publishers and verify SHA-256.

    py -3 download_data.py              # GECCO 2017, 2018, 2019 (~48 MB)
    py -3 download_data.py --waterhub   # also the Eawag WaterHub archive (1.3 GB)

Files land under research/data/ (gitignored). URLs, sizes and hashes match the
old project's data/external-sources.json; Zenodo's md5 values also agree.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import sys
import urllib.request

HERE = Path(__file__).resolve().parent
ZENODO = "https://zenodo.org/records/{record}/files/{name}?download=1"

# (local path, url, bytes, sha256, license)
GECCO = [
    ("gecco2017/1_gecco2017_water_quality.csv", ZENODO.format(record=3884465, name="1_gecco2017_water_quality.csv"),
     9563384, "8452e3c03b1d0b1ed81f8e85e90664c52fbe77a59e85c042a4e177cf3d753d1d", "CC-BY-4.0"),
    ("gecco2018/1_gecco2018_water_quality.csv", ZENODO.format(record=3884398, name="1_gecco2018_water_quality.csv"),
     10784171, "c41221f3045696b75b79374f4c41c63f6c988e1df03b1dedcdbf910d44ea71cd", "CC-BY-4.0"),
    ("gecco2019/7_gecco2019_train_water_quality.csv", ZENODO.format(record=4304080, name="7_gecco2019_train_water_quality.csv"),
     10787236, "05bbe6dea804b6fc6b2bf8ecc35f37c404ff3ae3503c47cf69301edf61c8b4b9", "CC-BY-4.0"),
    ("gecco2019/8_gecco2019_valid_water_qulity.csv", ZENODO.format(record=4304080, name="8_gecco2019_valid_water_qulity.csv"),
     4496965, "d451142a969f5972278cbfa53d840b04805ab683b81cad092bda30820ec2e424", "CC-BY-4.0"),
    ("gecco2019/6_gecco2019_test_water_quality.csv", ZENODO.format(record=4304080, name="6_gecco2019_test_water_quality.csv"),
     2621311, "ad509d0c1c656d3e48dc4e52011da5232d292997e6f7ce08eedd5f6194e3369f", "CC-BY-4.0"),
]
WATERHUB = [
    ("waterhub/ADASen_paper.zip",
     "https://opendata.eawag.ch/dataset/ba398cc7-e33a-4f87-84cb-3ce07cfe29d5/resource/"
     "880b5b77-2681-4692-b214-48978b638397/download/adasen_paper.zip",
     1315604172, "f91e930d1e194f401f4570c8ddbfdd90606475233e2f6cd36114ff9da11fc8b0", "CC0-1.0"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(dest, url, size, digest):
    if dest.exists() and dest.stat().st_size == size and sha256(dest) == digest:
        print(f"ok (already present)  {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"downloading {size / 1e6:,.1f} MB  {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "wareva-research"})
    with urllib.request.urlopen(request, timeout=120) as response, open(part, "wb") as out:
        shutil.copyfileobj(response, out, 1 << 20)
    actual = sha256(part)
    if actual != digest:
        part.unlink()
        sys.exit(f"SHA-256 mismatch for {dest.name}: got {actual}, expected {digest}")
    part.replace(dest)
    print(f"ok (sha256 verified)  {dest}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=HERE / "data")
    parser.add_argument("--waterhub", action="store_true",
                        help="also fetch the 1.3 GB WaterHub archive (run.py does not read it yet)")
    args = parser.parse_args()
    for path, url, size, digest, _ in GECCO + (WATERHUB if args.waterhub else []):
        fetch(args.data_dir / path, url, size, digest)


if __name__ == "__main__":
    main()
