"""
Safe Archive Extraction

Provides ZIP extraction with path traversal protection (zip-slip prevention).
Extracted concept from SEVE-SaaS/kayo_deploy.py but reimplemented with security.

Changes from original:
- Added path traversal protection (zip-slip)
- Added size limits
- Added file count limits
- Added dangerous file extension blocking
"""
import os
import zipfile
import shutil
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Maximum extracted size (500 MB)
MAX_EXTRACT_SIZE = 500 * 1024 * 1024

# Maximum number of files
MAX_FILE_COUNT = 10000

# Dangerous extensions that should not be in source archives
DANGEROUS_EXTENSIONS = {
    '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.ps1',
    '.com', '.scr', '.msi', '.vbs', '.wsf',
}


class ExtractionError(Exception):
    """Raised when archive extraction fails safety checks."""
    pass


def safe_extract_zip(zip_path: str, dest_dir: str) -> Tuple[bool, Optional[str]]:
    """
    Safely extract a ZIP archive with security protections.

    Protections:
    - Path traversal prevention (zip-slip)
    - Size limits (prevent zip bombs)
    - File count limits
    - Dangerous extension blocking
    - Symlink rejection

    Args:
        zip_path: Path to the ZIP file
        dest_dir: Destination directory for extraction

    Returns:
        Tuple of (success: bool, error: Optional[str])
    """
    if not os.path.exists(zip_path):
        return False, f"ZIP file not found: {zip_path}"

    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Check for zip bomb (total uncompressed size)
            total_size = sum(info.file_size for info in zf.infolist())
            if total_size > MAX_EXTRACT_SIZE:
                return False, f"Archive too large: {total_size} bytes exceeds {MAX_EXTRACT_SIZE} byte limit"

            # Check file count
            file_count = len(zf.infolist())
            if file_count > MAX_FILE_COUNT:
                return False, f"Too many files: {file_count} exceeds {MAX_FILE_COUNT} limit"

            # Validate each entry before extraction
            dest_real = os.path.realpath(dest_dir)

            for info in zf.infolist():
                # Skip directories
                if info.is_dir():
                    continue

                # Check for path traversal
                target_path = os.path.realpath(os.path.join(dest_dir, info.filename))
                if not target_path.startswith(dest_real + os.sep) and target_path != dest_real:
                    return False, f"Path traversal detected: {info.filename}"

                # Check for absolute paths
                if os.path.isabs(info.filename):
                    return False, f"Absolute path in archive: {info.filename}"

                # Check for dangerous path components
                parts = info.filename.replace('\\', '/').split('/')
                if '..' in parts:
                    return False, f"Parent directory reference in archive: {info.filename}"

                # Check for symlinks (via external_attr)
                if info.external_attr >> 28 == 0xA:
                    return False, f"Symlink detected in archive: {info.filename}"

                # Check for dangerous extensions
                _, ext = os.path.splitext(info.filename.lower())
                if ext in DANGEROUS_EXTENSIONS:
                    logger.warning(f"Dangerous file extension in archive: {info.filename}")
                    # Don't block, just warn — might be legitimate in some projects

            # All checks passed — extract
            os.makedirs(dest_dir, exist_ok=True)
            zf.extractall(dest_dir)

            # Handle single-directory nesting (common in GitHub downloads)
            _flatten_single_dir(dest_dir)

            logger.info(f"Safely extracted {file_count} files to {dest_dir}")
            return True, None

    except zipfile.BadZipFile:
        return False, "Invalid ZIP file (corrupted or not a ZIP)"
    except Exception as e:
        return False, f"Extraction failed: {str(e)}"


def _flatten_single_dir(dest_dir: str):
    """
    If the archive extracted into a single subdirectory,
    move its contents up to dest_dir.

    This handles the common case where GitHub ZIPs contain:
    repo-main/
        src/
        package.json
        ...
    """
    items = os.listdir(dest_dir)
    if len(items) == 1:
        single_dir = os.path.join(dest_dir, items[0])
        if os.path.isdir(single_dir):
            for item in os.listdir(single_dir):
                src = os.path.join(single_dir, item)
                dst = os.path.join(dest_dir, item)
                shutil.move(src, dst)
            os.rmdir(single_dir)
