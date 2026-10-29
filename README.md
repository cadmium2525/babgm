# 夜の音

[再生ページを開く](https://cadmium2525.github.io/babgm/)

Leaf-stream の水音をもとに作った、黒い画面の音声プレーヤーです。虫・鳥・風鈴・カウント音は含みません。

- 通常再生はループ。
- 「10 分 かけて停止」なら、準備後から10分全体をかけて小さくなり、停止します。待ち時間の後に短く消すタイマーではありません。0.1〜60分を指定できます。
- フェードは端末内でWAVに焼き込み、単一の `<audio>` で再生。画面が隠れた際に止まるJavaScriptタイマーには依存しません。準備中はループ再生を続けます。「フェード中」の表示後にロックしてください。準備中に閉じた場合は、画面に戻るとフェードを開始します。
- 一時停止するとフェードも止まり、再開時に続きから再生します。×でループに戻ります。
- 「画面を消す」は完全な黒を表示します。タップで戻ります。端末の画面ロックも利用できます。
- 音声まで保存できると「オフライン可」と表示。以後はネット接続なしで再生・フェード生成できます。ブラウザが保存領域を消去した場合は再接続が必要です。
- Android / Chromeはインストールボタン、iPhoneはSafariの共有メニューから「ホーム画面に追加」。PWAにはHTTPSかlocalhostが必要です。

バックグラウンド再生とロック画面操作には、通常のメディア再生・Media Session・対応端末のAudio Sessionを利用します。OS、ブラウザ、省電力、通話などの制約は残ります。タブやアプリを終了すると停止します。iPhoneの音量は本体ボタンで調整してください。

## ローカルで起動

```sh
npm run dev
```

`http://127.0.0.1:4173` を開きます。依存インストールやビルドは不要です。`dist/` はそのまま静的ホスティング・GitHub Pagesに配置できます。サブディレクトリ配信にも対応しています。

```sh
npm test
npm run audio
```

音源の生成方法と出典は [AUDIO.md](AUDIO.md) を参照してください。アプリ更新時には `dist/sw.js` のキャッシュ名を変更してください。旧画面を閉じた後の起動で更新が適用されます。

## GitHub Pages

`main` への push 後に GitHub Actions がテストを実行し、`dist/` を公開します。
公開先は <https://cadmium2525.github.io/babgm/>。ログインは不要です。
Pages の公開元は GitHub Actions に設定しています。

## 確認範囲

自動検証では、音源のループ境界、フェードの音量曲線と終端の無音、最大60分の生成、再生状態の遷移、一時停止・再開、準備の取消、画面が隠れている間の音源切替保留、オフライン用Range応答を確認しています。実際のスマートフォンでの画面ロック・省電力中の継続は実機確認が必要です。

設計参考：[Media Session](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)、[Audio Session](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API)、[音声キャッシュとRange](https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video)。
