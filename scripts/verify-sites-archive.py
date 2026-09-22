"""Check a local Sites tar against the already source-checked build seal.
Run release:check before packaging; this check does not authorize dirty releases.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile


def verify(archive, project, allow_fs_metadata=False):
    manifest_bytes = (project / 'dist/artifact-manifest.json').read_bytes()
    provenance = json.loads((project / 'dist/build-provenance.json').read_text())
    if hashlib.sha256(manifest_bytes).hexdigest() != provenance['artifactManifestSha256']:
        raise ValueError('Artifact manifest seal differs')
    manifest = json.loads(manifest_bytes)
    if manifest['target'] != 'sites':
        raise ValueError('Expected Sites artifacts')
    expected = {item['path']: (item['bytes'], item['sha256']) for item in manifest['files']}
    for name in ('dist/artifact-manifest.json', 'dist/build-provenance.json'):
        data = (project / name).read_bytes()
        expected[name] = (len(data), hashlib.sha256(data).hexdigest())
    actual = {}
    with tarfile.open(archive, 'r:*') as bundle:
        for entry in bundle:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'dist':
                raise ValueError('Archive path escapes dist')
            if not entry.isdir() and not entry.isfile():
                raise ValueError('Archive contains a link or special file')
            if not allow_fs_metadata and any('xattr' in key.lower() or 'mac_metadata' in key.lower() for key in entry.pax_headers):
                raise ValueError('Archive contains filesystem metadata')
            if entry.isfile():
                if entry.name in actual or entry.name not in expected:
                    raise ValueError('Archive contains duplicate or unexpected files')
                digest = hashlib.sha256()
                size = 0
                stream = bundle.extractfile(entry)
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    size += len(chunk)
                    digest.update(chunk)
                actual[entry.name] = (size, digest.hexdigest())
    if actual != expected:
        raise ValueError('Archive publication files are missing or changed')
    return len(actual)


def normalize_metadata(archive, project, output):
    # First prove exact file membership/content. Never drop an unexpected file.
    verify(archive, project, allow_fs_metadata=True)
    if archive.resolve() == output.resolve() or output.exists():
        raise ValueError('Normalized output must be a new archive path')
    with tarfile.open(archive, 'r:*') as original, tarfile.open(output, 'w:gz', format=tarfile.PAX_FORMAT) as normalized:
        for entry in original:
            clean = tarfile.TarInfo(entry.name)
            clean.type = tarfile.DIRTYPE if entry.isdir() else tarfile.REGTYPE
            clean.mode = 0o755 if entry.isdir() else 0o644
            clean.size = 0 if entry.isdir() else entry.size
            clean.mtime = 0
            # Deliberately omit xattrs, owner identity and platform metadata.
            normalized.addfile(clean, None if entry.isdir() else original.extractfile(entry))
    return verify(output, project)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('project', type=Path, nargs='?', default=Path.cwd())
    parser.add_argument('--normalize-to', type=Path)
    args = parser.parse_args()
    try:
        count = (normalize_metadata(args.archive, args.project, args.normalize_to)
                 if args.normalize_to else verify(args.archive, args.project))
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        raise SystemExit(f'Sites archive check failed: {error}') from error
    print(f'Sites archive matches the sealed output: {count} regular files. No upload performed.')
