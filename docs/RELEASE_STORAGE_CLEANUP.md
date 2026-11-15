# GitHub Android release storage cleanup

As of 2026-11-15, `android-latest` contained 94 files totalling about 4.12 GB.
Forty-five version-name aliases had SHA-256-identical canonical (versionCode)
APKs; those 45 aliases together occupied approximately 2.04 GB and showed
zero GitHub downloads at the time of the audit.

## Required retention

Keep all `Kun-Online-Mobile-v<version>-c<code>.apk` canonical APKs because
the app updater manifest points to those URLs. Keep the current-version alias,
`Kun-Online-Mobile.apk`, `Kun-Online-Mobile-latest.json`, and the release tag.

## Safe manual process

In Actions choose **Android release storage cleanup (manual and conservative)**.

1. Run with `apply=false` first. The workflow runs selector unit tests,
   displays each candidate ID, SHA-256, size, and total removable bytes.
2. Review the proposed deletions and any historic external dependencies.
3. Only if satisfied, run `apply=true`, entering
   `DELETE_VERIFIED_ZERO_DOWNLOAD_DUPLICATES` in the confirmation field.

The workflow can delete ONLY historic unversionCoded alias APKs that have
zero GitHub downloads, exactly matching SHA-256 digest and size against a
retained canonical APK, and are older than the highest versionCode.
It never runs on push/schedule and does not delete any Git repository files,
release tags, newest aliases, manifests, or canonical binaries.

## Future uploads

The separate signed-release workflow should publish the canonical versionCode
APK, the stable direct link and manifest. Uploading a third byte-identical
version-name alias in every release is not needed by the current manifest
updater. Any decision to stop publishing that compatibility alias should
be reviewed separately to ensure no external clients rely on it.

Deleting release assets is independent of Git history and cannot be rolled
back by reverting a commit. Review the dry run before applying.
