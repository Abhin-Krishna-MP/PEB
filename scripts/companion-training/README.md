# Companion training

The checked-in ONNX files are generated from random initialization. The training inputs are original short English scenes, labelled story fragments, and question examples in this directory. No pretrained weights, downloaded datasets, or API calls are used. Python and its dependencies are needed only to retrain.

```sh
python -m pip install numpy==2.5.5 onnx==1.19.1
python scripts/companion-training/train.py
```

The emotion network uses hashed English word prefixes and bigrams with a 64-unit hidden layer. The question network learns to predict the next token from the detected story event, previous token, position, and a style index. It can copy a character name from the relevant sentence. It uses a bounded vocabulary and can produce a narrow range of sentence structures.

The emotion model identified 13 of 20 reserved short scenes correctly on the current training run. This small, authored set measures development progress and provides limited evidence for unfamiliar novels. Its classes can be confused, particularly when emotions are mixed or implied. There is no semantic understanding of a whole book. Folio uses confidence thresholds, bounded recent context, and its existing pacing rules to limit interruptions.
