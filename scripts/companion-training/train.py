"""Train Folio's two compact networks from random initialization.

Run from any directory with Python 3.12, numpy==2.5.5 and onnx==1.19.1.
"""
from collections import Counter
import json
from pathlib import Path
import re

import numpy as np
from onnx import TensorProto, checker, helper as h, numpy_helper

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'src' / 'companion'
WIDTH = 1536
rng = np.random.default_rng(20261126)
questions = json.loads((HERE / 'questions.json').read_text())
labels = list(questions)
corpus = {label: [] for label in labels}
for line in (HERE / 'stories.txt').read_text().splitlines():
    if line.startswith('['):
        label = line[1:-1]
    elif line.strip():
        corpus[label].append(line)


def features(text):
    words = re.findall("[a-z]+(?:'[a-z]+)?", text.lower())[:160]
    x = np.zeros(WIDTH, np.float32)
    # Prefixes share evidence for ordinary inflections. Bigrams preserve local context.
    roots = [word[:5] for word in words]
    keys = roots + [a + '/' + b for a, b in zip(roots, roots[1:])]
    for key, count in Counter(keys).items():
        hashed = 2166136261
        for char in key:
            hashed = ((hashed ^ ord(char)) * 16777619) & 0xffffffff
        x[hashed % WIDTH] += min(2, count) * (.45 if '/' in key else 1)
    return x / max(1, np.linalg.norm(x))


def fit(x, y, hidden, classes, epochs):
    params = [
        rng.normal(0, .12, (x.shape[1], hidden)).astype(np.float32), np.zeros(hidden, np.float32),
        rng.normal(0, .13, (hidden, classes)).astype(np.float32), np.zeros(classes, np.float32),
    ]
    first = [np.zeros_like(p) for p in params]
    second = [np.zeros_like(p) for p in params]
    step = 0
    for _ in range(epochs):
        for indices in np.array_split(rng.permutation(len(y)), max(1, (len(y) + 63) // 64)):
            step += 1
            a, b, c, d = params
            batch = x[indices]
            z = batch @ a + b
            active = np.maximum(z, 0)
            logits = active @ c + d
            pr = np.exp(logits - logits.max(axis=1, keepdims=True))
            pr /= pr.sum(axis=1, keepdims=True)
            pr[np.arange(len(indices)), y[indices]] -= 1
            pr /= len(indices)
            dh = (pr @ c.T) * (z > 0)
            gradients = [batch.T @ dh + 2e-4 * a, dh.sum(axis=0), active.T @ pr + 2e-4 * c, pr.sum(axis=0)]
            for p, m, v, grad in zip(params, first, second, gradients):
                m += .1 * (grad - m)
                v += .001 * (grad * grad - v)
                p -= .007 * (m / (1 - .9 ** step)) / (np.sqrt(v / (1 - .999 ** step)) + 1e-7)
    return params


def export(name, parameters):
    nodes, initializers = [], []
    for index, weight in zip(('a', 'c'), parameters[::2]):
        scale = np.float32(max(abs(weight).max(), 1e-6) / 127)
        q = np.round(weight / scale).clip(-127, 127).astype(np.int8)
        initializers.extend(numpy_helper.from_array(value, index + suffix)
                            for suffix, value in [('q', q), ('s', np.array(scale)), ('z', np.array(0, np.int8))])
        nodes.append(h.make_node('DequantizeLinear', [index + s for s in 'qsz'], [index]))
    initializers.extend(numpy_helper.from_array(p, name) for p, name in zip(parameters[1::2], ('b', 'd')))
    nodes.extend([
        h.make_node('Gemm', ['input', 'a', 'b'], ['hidden']),
        h.make_node('Relu', ['hidden'], ['activated']),
        h.make_node('Gemm', ['activated', 'c', 'd'], ['logits']),
    ])
    graph = h.make_graph(nodes, name, [h.make_tensor_value_info('input', TensorProto.FLOAT, [None, parameters[0].shape[0]])],
                         [h.make_tensor_value_info('logits', TensorProto.FLOAT, [None, parameters[-1].size])], initializers)
    model = h.make_model(graph, producer_name='Folio', opset_imports=[h.make_opsetid('', 18)], ir_version=9)
    checker.check_model(model)
    (OUT / (name + '.onnx')).write_bytes(model.SerializeToString())


# Training folds stay separate from held-out scenes. Augment with ordinary
# surrounding prose and word dropout to reduce dependence on exact phrasing.
train_x, train_y, test_x, test_y = [], [], [], []
for i, label in enumerate(labels):
    for story in corpus[label][-2:]:
        test_x.append(features(story))
        test_y.append(i)
    for story in corpus[label][:-2]:
        tokens = story.split()
        for extra in range(17):
            fragment = story if extra == 0 else ' '.join(word for word in tokens if rng.random() > .19)
            if extra >= 8:
                context = corpus['quiet'][rng.integers(0, len(corpus['quiet']) - 2)]
                fragment = context + ' ' + fragment if extra % 2 else fragment + ' ' + context
            train_x.append(features(fragment))
            train_y.append(i)
for label, motifs in json.loads((HERE / 'motifs.json').read_text()).items():
    for motif in motifs:
        for prefix, suffix in [('', ''), ('In the end, ', '.'), ('They had come a long way. ', ' Then the scene changed.'),
                               ('By the time they reached it, ', '.'), ('The light shifted. ', ' Nobody spoke.')]:
            train_x.append(features(prefix + motif + suffix))
            train_y.append(labels.index(label))
emotion = fit(np.stack(train_x), np.array(train_y), 64, len(labels), 42)
a, b, c, d = emotion
top = (np.maximum(np.stack(test_x) @ a + b, 0) @ c + d).argmax(axis=1)
print(f'Emotion held-out top-1 {np.sum(top == test_y)}/{len(test_y)}')
export('emotion', emotion)

vocab = ['<start>', '<end>'] + sorted({token for variants in questions.values() for question in variants for token in question.split()})
max_steps = 16
decoder_width = len(labels) + 3 + max_steps + len(vocab)
decoder_x, decoder_y = [], []
for label, variants in questions.items():
    for style, question in enumerate(variants):
        previous = 0
        for step, token in enumerate(question.split() + ['<end>']):
            x = np.zeros(decoder_width, np.float32)
            x[[labels.index(label), len(labels) + style, len(labels) + 3 + step, len(labels) + 3 + max_steps + previous]] = 1
            previous = vocab.index(token)
            decoder_x.append(x)
            decoder_y.append(previous)
decoder = fit(np.stack(decoder_x), np.array(decoder_y), 75, len(vocab), 175)
a, b, c, d = decoder
assert np.array_equal((np.maximum(np.stack(decoder_x) @ a + b, 0) @ c + d).argmax(axis=1), decoder_y)
export('questions', decoder)
(OUT / 'vocabulary.json').write_text(json.dumps({'labels': labels, 'features': WIDTH, 'tokens': vocab, 'maxSteps': max_steps}, indent=2) + '\n')
