# Simple ScreenShot

[![CI](https://github.com/Aero123421/SimpleScreenShot/actions/workflows/ci.yml/badge.svg)](https://github.com/Aero123421/SimpleScreenShot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Aero123421/SimpleScreenShot)](https://github.com/Aero123421/SimpleScreenShot/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0%20OR%20GPL--3.0--or--later-blue)](LICENSE)

Ubuntu 24.04 / GNOME Shell 46 向けに、**Windows 11 の「切り取りツール」に近い軽快な操作感**を目指して作ったスクリーンショット拡張機能＋注釈エディタです。

> A fast, Windows-style frozen-screen snipping overlay and native GTK4/Libadwaita annotation editor for Ubuntu 24.04 / GNOME Shell 46.

`Shift + Super + S` を押した瞬間に画面が静止し、マウスカーソルがあるモニターの上部に切り取りツールバーが表示されます。範囲・ウィンドウ・画面を選ぶだけでクリップボードへ即コピー＆自動保存され、プレビュー通知からそのまま注釈エディタを開いて書き込めます。

---

## 主な特徴

### 1. 撮影オーバーレイ（GNOME Shell 拡張）
- **3つの撮影モード**: 四角形の領域 / ウィンドウ単体 / 画面全体
- **マルチモニター & HiDPI / フラクショナルスケール対応**: ツールバーとヒントをアクティブモニター基準で配置し、左右モニターの境目を跨ぎません。拡大率 125% / 150% / 200% でも端の 1px ズレを防ぎます
- **重なりを混ぜないウィンドウ撮影**: ウィンドウモードでは対象ウィンドウ単体のテクスチャを直接取得するため、手前に重なった別ウィンドウや他アプリのカーソルが写り込みません
- **フルスクリーン対応 & 視界を遮らない選択**: フルスクリーンアプリ上でも動作し、範囲ドラッグ中はツールバーとヒントが自動で退避します
- **非同期保存 & プレビュー通知**: 撮影音の再生、クリップボードへの即コピー、PNG 自動保存を GNOME Shell を止めずに非同期実行。通知からワンクリックで編集またはファイルマネージャーでの強調表示ができます

### 2. 注釈エディタ（独立した GTK4 / Libadwaita アプリ）
- **ダーク／ライト両モード完全対応**: Libadwaita 1.5 のネイティブテーマとカスタムシンボリックアイコン（Yaru / Adwaita 両対応）により、デスクトップの配色やアクセントカラーに自然になじみます
- **8種類の注釈・編集ツール**:
  - **ペン / 蛍光ペン**（ベジェ曲線による滑らかな線・単点ドット対応）
  - **矢印 / 四角形 / 楕円**（`Shift` ドラッグで 45°・正方形・正円に固定）
  - **文字**（PangoCairo による日本語・複数行対応、背景に応じて視認性を保つ縁取り付き、IME の変換確定を邪魔しない `Ctrl + Enter` 確定）
  - **モザイク**（既存の注釈も含めた合成済みレイヤーから低解像度化・透過 PNG 対応・4段階の粒度調整）
  - **非破壊切り抜き**（8ハンドルでのリサイズ・内部ドラッグ移動・三分割ガイド・リアルタイム寸法表示）
- **快適な閲覧と履歴管理**: スクロール連動ズーム（`Ctrl + ホイール`）、中ボタンドラッグによるパン移動、縦長・横長の比率を保つ非同期サムネイル付き履歴サイドバー、画像ファイルの読み込み（`Ctrl + O` / ドラッグ＆ドロップ）
- **データを壊さない安全な保存設計**:
  - メモリ内 PNG エンコード＋アトミック置換で、書込失敗時の元ファイル破損を防ぎ、パーミッション（`0600` 等）やシンボリックリンクを維持
  - SVG / JPEG / WebP などの非 PNG 画像や一時キャプチャは `Ctrl + S` で元ファイルを壊さず「名前を付けて保存…」へ自動誘導
  - 変更破棄の確認ダイアログ、複数ウィンドウ同時編集の ETag 競合検知、GNOME の `disable-save-to-disk` ポリシー準拠

### 3. 設定画面（日本語・英語完全対応）
- **押すだけで登録できるショートカット記録ダイアログ**（既定: `Shift + Super + S`、記録中のシステムショートカット抑制・キーボード移動対応）
- **保存先フォルダー**（ワンクリック初期化付き）と**ライブプレビュー付きファイル名パターン**（`{date}` / `{time}` / `{timestamp}`）
- クリップボードコピー、自動保存、プレビュー通知、撮影直後のエディタ起動、マウスポインター表示、トップパネルアイコン、履歴件数（1〜200）の切り替え

---

## 動作環境

| コンポーネント | 要件 |
|---|---|
| OS | Ubuntu 24.04 LTS |
| GNOME Shell | 46 |
| GJS | 1.80 以降 |
| GTK / Libadwaita | GTK 4.14 以降 / Libadwaita 1.5 以降 |

Ubuntu 24.04 の標準デスクトップ環境には、通常これらがすべて含まれています。

---

## インストール

### ワンラインインストール（推奨）
GitHub Releases から最新パッケージと SHA-256 チェックサムを取得し、検証後にインストールします。

```bash
curl -fsSL https://raw.githubusercontent.com/Aero123421/SimpleScreenShot/main/scripts/install-online.sh | sh
```

特定バージョンを指定してインストールする場合：

```bash
curl -fsSL https://raw.githubusercontent.com/Aero123421/SimpleScreenShot/main/scripts/install-online.sh | SIMPLE_SCREENSHOT_VERSION=v0.2.0 sh
```

> スクリプトの内容を事前に確認したい場合は [scripts/install-online.sh](scripts/install-online.sh) をご覧ください。

### インストール後の反映
- **初回インストール・アップデート後**: 一度ログアウトして再ログインしてください（X11 環境では `Alt + F2` → `r` → `Enter` で GNOME Shell を再読み込みできます）。
- **起動方法**:
  - `Shift + Super + S`
  - トップパネル右上のカメラアイコン
  - アプリ一覧の「Simple ScreenShot エディタ」

### アンインストール

```bash
sh scripts/uninstall.sh
```

リポジトリを手元に持っていない場合は、Extensions アプリから「Simple ScreenShot」を削除してください。

---

## 操作とショートカット

### 撮影オーバーレイ

| 操作 | 動作 |
|---|---|
| `R` / `1` | 四角形の領域モード |
| `W` / `2` | ウィンドウモード |
| `F` / `3` | 画面全体モード |
| ドラッグ / クリック | 選択範囲・対象を撮影 |
| `Enter` / `Space` | ウィンドウ・画面モードで強調中の対象を確定撮影 |
| `Esc` / 右クリック | ドラッグ中なら選択リセット、未選択時ならキャンセル |

### 注釈エディタ

| 操作 | 動作 |
|---|---|
| `1` 〜 `8` | ツール切替（ペン / 蛍光ペン / 矢印 / 四角形 / 楕円 / 文字 / モザイク / 切り抜き） |
| `Shift` + ドラッグ | 矢印を 45° 刻み、四角形を正方形、楕円を正円に固定 |
| `Ctrl + Z` | 元に戻す |
| `Ctrl + Y` / `Ctrl + Shift + Z` | やり直す |
| `Ctrl + C` | 編集結果をクリップボードへコピー |
| `Ctrl + S` | 保存（非 PNG・一時保存の場合は別名保存） |
| `Ctrl + Shift + S` | 名前を付けて保存 |
| `Ctrl + O` / ファイルをドロップ | 任意の画像ファイルを開く |
| `Ctrl + +` / `Ctrl + -` / `Ctrl + ホイール` | 拡大・縮小 |
| `Ctrl + 0` / `Ctrl + 1` | ウィンドウに合わせる / 原寸 100% 表示 |
| 中ボタンドラッグ | 拡大中のキャンバスをパン移動 |
| 文字入力中の `Ctrl + Enter` | テキストを確定（通常の `Enter` は改行・IME 確定） |
| クロップ中の `Enter` / `Esc` | 切り抜きを適用 / キャンセル |

---

## 開発とテスト

開発時の構文チェック・単体テストには Node.js を使用します。

```bash
git clone https://github.com/Aero123421/SimpleScreenShot.git
cd SimpleScreenShot

make check          # スキーマ・構文・単体テスト・PNG出力・ウィンドウ起動・ZIP検証
make run-editor     # サンプル画像で注釈エディタを単体起動
make pack           # 配布用 ZIP を dist/ に生成
make release-assets # 検証＋配布 ZIP＋SHA-256 チェックサムを生成
make install        # 検証後にローカル環境へインストール
make uninstall      # ローカル環境からアンインストール
```

### ディレクトリ構成

```text
extension/
  extension.js         GNOME Shell 統合・キーバインド・通知・エディタ起動
  overlay.js           マルチモニター対応の静止画面オーバーレイ
  capture.js           非同期スクリーンショット切り出し・保存・履歴管理
  indicator.js         トップパネルのカメラメニュー
  prefs.js             Libadwaita 設定画面とショートカット記録ダイアログ
  geometry.js          座標・制約・ファイル名・ロケール判定の純粋ユーティリティ
  i18n.js              拡張・設定画面の英日ローカライズ
  stylesheet.css       GNOME Shell オーバーレイ用スタイル
  schemas/             GSettings スキーマ
  editor/              独立プロセスの GTK4 / Libadwaita 注釈エディタ
    main.js            CLI エントリポイント & ヘッドレス統合セルフテスト
    application.js     Adw.Application・カスタムアイコン・テーマ登録
    window.js          エディタウィンドウ・履歴サイドバー・保存／競合制御
    canvas.js          Cairo / PangoCairo 描画・合成モザイク・PNG エクスポート
    history.js         履歴インデックス読み込み
    icons/             全8ツール用カスタムシンボリック SVG アイコン
scripts/               検査・パッケージング・ローカル／オンライン導入・削除
tests/                 座標計算・キーバインド・翻訳整合性の自動テスト
desktop/               エディタ用デスクトップエントリテンプレート
```

GNOME Shell プロセス内で実行する処理を最小限（撮影と通知）に抑え、画像編集は別プロセスの GTK4 アプリに分離することで、GNOME Shell 本体の安定性を保つ設計にしています。

---

## プライバシーとポリシー

- 撮影画像・履歴・設定はすべてローカルに保存されます。テレメトリやクラウド送信機能は一切ありません。
- 外部通信を行うのは [install-online.sh](scripts/install-online.sh) が GitHub Releases から配布アーカイブと SHA-256 を取得するときのみです。
- GNOME のロックダウン設定（`org.gnome.desktop.lockdown` の `disable-save-to-disk`）が有効な環境では、拡張・エディタともにディスク書き込みを行いません。

---

## サポート対象範囲

GNOME Shell の内部 API はメジャーバージョン間で変更されるため、現在は **GNOME Shell 46（Ubuntu 24.04）** のみを対象としています。GNOME 47 以降への対応は各バージョンでの実機検証後に `metadata.json` へ追加する方針です。

---

## コントリビューション & ライセンス

不具合報告・機能提案は [GitHub Issues](https://github.com/Aero123421/SimpleScreenShot/issues) へ、開発参加の手順は [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

本プロジェクトはデュアルライセンス（`Apache-2.0 OR GPL-3.0-or-later`）で提供されています。利用目的に応じて以下のいずれかを選択できます。

- [Apache License 2.0](LICENSE-APACHE)
- [GNU General Public License v3.0 or later](LICENSE-GPL)
