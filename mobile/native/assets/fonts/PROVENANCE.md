# Bundled fonts

Downloaded 2026-11-04 from the Expo Google Fonts repository's static TTF assets. These files load through `expo-font`; the application does not fetch fonts at runtime. Each family is distributed under the SIL Open Font License 1.1; the corresponding full license is beside the fonts.

| Local file | Upstream path under `https://raw.githubusercontent.com/expo/google-fonts/master/font-packages/` |
| --- | --- |
| Inter-Regular.ttf | inter/400Regular/Inter_400Regular.ttf |
| Inter-SemiBold.ttf | inter/600SemiBold/Inter_600SemiBold.ttf |
| PirataOne-Regular.ttf | pirata-one/400Regular/PirataOne_400Regular.ttf |
| JetBrainsMono-Regular.ttf | jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf |
| NotoSansArabic-Regular.ttf | noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf |

License originals: Google Fonts repository `ofl/inter/OFL.txt`, `ofl/pirataone/OFL.txt`, `ofl/jetbrainsmono/OFL.txt`, and `ofl/notosansarabic/OFL.txt`. Font SHA-256 hashes are recorded in `validation/artifacts/font-hashes.json`. Font loading failure uses native system fonts. Both platform bundles contain all five assets; actual font shaping/loading on a phone remains NOT DEVICE-VERIFIED.
