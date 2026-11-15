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

The signed-release workflow in this draft change keeps the canonical
versionCode APK, stable direct link and manifest, but stops uploading the
third byte-identical version-name alias in future releases. The current
manifest updater uses the canonical URL. Review compatibility with any
external clients before merging the draft PR.

Deleting release assets is independent of Git history and cannot be rolled
back by reverting a commit. Review the dry run before applying.
