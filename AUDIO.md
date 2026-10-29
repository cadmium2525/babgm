# 水音

元のゲーム: <https://cadmium2525.github.io/Leaf-stream/race>

実装の参照: <https://github.com/cadmium2525/Leaf-stream/blob/250eb38e1835bb1502318da786b324e2ccf8d1df/src/audio/ambience.ts>

ゲームの環境音は録音ではなく Web Audio による合成です。`scripts/generate-audio.mjs` は `Ambience.water()` の水音の構成を再現します。ブラウンノイズの低域（900 Hz、ゲイン 0.5）と、揺らぐ帯域ノイズ（中心 2400 Hz、Q 0.8、0.23 Hz / ±700 Hz、ゲイン 0.025）を、マスター 0.6 で混合します。虫・小鳥・風鈴・カウントダウンは生成しません。元のコードと同じ 4 秒 / 3 秒のノイズ周期を使用します。

合成は参照サンプルレート 48 kHz で行います。ブラウンノイズの再帰式がサンプルレートで音色を変えるため、16 kHz で直接合成せず、127 tap の Blackman 窓 sinc FIR（カットオフ 6500 Hz）で帯域制限してから 16 kHz に間引きます。

出力は固定シード・モノラル・16 kHz・PCM 16 bit・300 秒。4 秒の低音、3 秒の帯域ノイズ、100 秒で元に戻る 0.23 Hz の揺らぎがすべて一致する共通周期です。12 秒のフィルター安定化後から合成し、クロスフェードや終端の無音は加えません。次周期の先頭1秒と一致することを16 bit PCMで検証しています。元のランダムなステレオ音声の録音ではなく、同じ合成方法に基づく再生成です。元ゲームの AudioContext のレートは再生端末で異なり得ます。

通常再生には `AudioBufferSourceNode.loop` を使います。ページ側のタイマーや `<audio>` の先頭へのシークでつなぎ直さず、同じノードを音声レンダラー内で連続再生します。一時停止時には位置を保存し、再開時にその位置からソースを作ります。再生操作の中で AudioContext を再開し、対応環境では Audio Session を `playback` に設定。Media Session の再生・停止操作も受け付けます。Web Audio が利用できない場合は従来のネイティブ音声へフォールバックします。OS・ブラウザーの背景再生規則による制約は残ります。

## 再生成

Node.js の標準ライブラリのみで実行できます。

```sh
node scripts/generate-audio.mjs
node scripts/verify-audio.mjs
```

生成先は `dist/audio/water.wav`。生成時にピーク・RMS・境界差分・SHA-256 を表示します。
`node scripts/vendor-encoder.mjs` はネット接続時にバージョン固定のエンコーダーとライセンスを再取得します（MP3 コードの SHA-256 を検証）。通常の生成・検証では通信は発生しません。

## フェード worker

`new Worker('./fade-worker.js')` に次を送ります。

```js
worker.postMessage({ id: 'unique-id', minutes: 10, offsetSeconds: 12.4 });
```

- `minutes`: 0.1〜60。指定時間の全体にわたり、余弦カーブで現在の水音を 100% から 0% に下げます。冒頭 30 ms はクリック防止の立ち上がりがあります。
- `offsetSeconds`: 元のループ内で音声をつなぐ位置。省略時 0。
- `format`: 省略時 `wav`。任意の開発用途では `mp3` も指定できます。
- 返信: `{ id, type: 'progress', value: 0…1 }`、`{ id, type: 'done', blob, duration, format }`、または `{ id, type: 'error', message, error }`。
- `{ type: 'cancel' }` または新しい生成要求で前の処理を中断します。

フェード開始操作では、現在の位置を保ってネイティブ `<audio>` へ引き継ぎ、その操作の中で再生を許可します。生成後の Blob URL を同じ要素に設定し、`loop = false` で再生します。フェードはファイルの音量に直接反映してあり、画面消灯後の JavaScript タイマーに依存しません。生成中は準備時間が必要です。切り替え時点までの進行を厳密に合わせる場合は `offsetSeconds` の見込み位置を呼び出し側で選びます。既定の WAV は指定時間ぴったりのサンプル数で生成します。

既定の WAV は 10 分で約 19.2 MB、60 分で約 115.2 MB。PCM は小分けに合成して不変の Blob チャンクを連結し、全時間分の Float32 音声や、別の巨大な可変 PCM 配列を保持しません。Node.js の実測では、10 分の生成が約 0.54 秒 / プロセス全体 RSS 79 MB、60 分が約 3.18 秒 / RSS 172 MB でした。端末とブラウザーにより処理時間・メモリは変わります。

任意の MP3 モードは同梱の lamejs 1.2.1 でモノラル 48 kbps に変換します。60 分で約 21.6 MB ですが、長時間の変換は数分以上かかることがあるため、ページの通常動作では使用しません。MP3 のエンコーダー遅延・終端パディングにより、無音部分を含むメディア時間は指定時間より約 0.1 秒長くなることがあります（6 秒の生成で 6.084 秒を確認）。エンコーダー読み込みに失敗した場合は PCM WAV にフォールバックします。通常の WAV 利用にエンコーダーやネット接続は不要です。バックグラウンド継続は OS・ブラウザーのメディア再生規則に依存します。

検証は `node scripts/verify-audio.mjs`。最大時間の PCM は `node scripts/verify-audio.mjs --max-wav`、指定した分数では `--wav-minutes=10` で確認できます。60 分 MP3 の実測は長時間だったため完了前に打ち切り、MP3 の最大時間の完走は未確認です。

## 同梱ライブラリ

- lamejs 1.2.1: <https://github.com/zhuker/lamejs>
- 配布元: <https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js>
- ライセンス: LGPL-3.0。上流の同梱案内は `dist/vendor/LICENSE.lamejs`、全文は `dist/vendor/LGPL-3.0.txt` と `dist/vendor/GPL-3.0.txt`、パッケージ情報は `dist/vendor/package.lamejs.json`。バージョン固定のソースパッケージ: <https://registry.npmjs.org/lamejs/-/lamejs-1.2.1.tgz>。
- LAME: <https://lame.sourceforge.net/>。エンコーダーに変更は加えていません。`dist/vendor/lame.min.js` は別ファイルとして同梱しており、同じ API の互換版に置き換えられます。

元ゲームの権利表記と公開ライセンスはリポジトリ側も参照してください。利用者の要望に従い音源の合成構成を参照しており、元のゲームそのものを同梱していません。
