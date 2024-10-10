const { scripts, scriptKeys } = require('./scripts');
const languageData = require('./languages.json');
const data = require('./data.json');

const und = () => [['und', 1]];

class Language {
  constructor() {
    this.languagesAlpha3 = {};
    this.languagesAlpha2 = {};
    this.extraSentences = [];
    this.buildData();
  }

  static getTrigrams(srcValue) {
    const result = [];
    const value = srcValue
      ? ` ${String(srcValue)
          .replace(/[\u0021-\u0040]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()} `
      : '';
    if (!value || value.length < 3) {
      return result;
    }
    for (let i = 0, l = value.length - 2; i < l; i += 1) {
      result[i] = value.substr(i, 3);
    }
    return result;
  }

  static asTuples(value) {
    const dictionary = Language.getTrigrams(value).reduce((srcprev, current) => {
      const prev = srcprev;
      prev[current] = (prev[current] || 0) + 1;
      return prev;
    }, {});
    const tuples = [];
    Object.keys(dictionary).forEach((key) => {
      tuples.push([key, dictionary[key]]);
    });
    tuples.sort((a, b) => a[1] - b[1]);
    return tuples;
  }

  static getDistance(trigrams, model) {
    let distance = 0;
    trigrams.forEach((currentTrigram) => {
      distance += currentTrigram[0] in model ? Math.abs(currentTrigram[1] - model[currentTrigram[0]] - 1) : 300;
    });
    return distance;
  }

  static getOccurrence(value, expression) {
    const count = value.match(expression);
    return (count ? count.length : 0) / value.length || 0;
  }

  static isLatin(value) {
    let total = 0;
    const half = value.length / 2;
    for (let i = 0; i < value.length; i += 1) {
      const c = value.charCodeAt(i);
      if (c >= 32 && c <= 126) {
        total += 1;
        if (total > half) {
          return true;
        }
      }
    }
    return total > half;
  }

  static getTopScript(value) {
    if (Language.isLatin(value)) {
      return ['Latin', 1];
    }
    let topCount = -1;
    let topScript;
    for (let i = 0; i < scriptKeys.length; i += 1) {
      const script = scriptKeys[i];
      const count = Language.getOccurrence(value, scripts[script]);
      if (count > topCount) {
        topCount = count;
        topScript = script;
        if (topCount === 1) {
          return [topScript, topCount];
        }
      }
    }
    return [topScript, topCount];
  }

  static filterLanguages(languages, allowList, denyList) {
    if (allowList.length === 0 && denyList.length === 0) {
      return languages;
    }
    const filteredLanguages = {};
    Object.keys(languages).forEach((language) => {
      if ((allowList.length === 0 || allowList.indexOf(language) > -1) && denyList.indexOf(language) === -1) {
        filteredLanguages[language] = languages[language];
      }
    });
    return filteredLanguages;
  }

  static getDistances(trigrams, srcLanguages, options) {
    const distances = [];
    const allowList = options.allowList || [];
    const denyList = options.denyList || [];
    const languages = Language.filterLanguages(srcLanguages, allowList, denyList);
    if (!languages) {
      return und();
    }
    Object.keys(languages).forEach((language) => {
      distances.push([language, Language.getDistance(trigrams, languages[language])]);
    });
    return distances.sort((a, b) => a[1] - b[1]);
  }

  static detectAll(srcValue, settings = {}) {
    const minLength = settings.minLength || 10;
    if (!srcValue || srcValue.length < minLength) {
      return und();
    }
    const value = srcValue.substr(0, 2048);
    const script = Language.getTopScript(value);
    if (!(script[0] in data) && script[1] > 0.5) {
      if (settings.allowList) {
        if (settings.allowList.includes(script[0])) {
          return [[script[0], 1]];
        }
        if (script[0] === 'cmn' && settings.allowList.includes('jpn')) {
          return [['jpn', 1]];
        }
      } else {
        return [[script[0], 1]];
      }
    }

    if (data[script[0]]) {
      const distances = Language.getDistances(Language.asTuples(value), data[script[0]], settings);
      if (distances[0][0] === 'und') {
        return [[script[0], 1]];
      }
      const min = distances[0][1];
      const max = value.length * 300 - min;
      return distances.map((d) => [d[0], 1 - (d[1] - min) / max || 0]);
    }
    return [[script[0], 1]];
  }

  buildData() {
    for (let i = 0; i < languageData.length; i += 1) {
      const language = {
        alpha2: languageData[i][0],
        alpha3: languageData[i][1],
        name: languageData[i][2],
      };
      this.languagesAlpha3[language.alpha3] = language;
      this.languagesAlpha2[language.alpha2] = language;
    }
  }

  transformAllowList(allowList) {
    const result = [];
    for (let i = 0; i < allowList.length; i += 1) {
      if (allowList[i].length === 3) {
        result.push(allowList[i]);
      } else {
        const language = this.languagesAlpha2[allowList[i]];
        if (language) {
          result.push(language.alpha3);
        }
      }
    }
    return result;
  }

  guess(utterance, allowList, limit) {
    const options = {};
    if (utterance.length < 10) {
      options.minLength = utterance.length;
    }
    if (allowList && allowList.length && allowList.length > 0) {
      options.allowList = this.transformAllowList(allowList);
    }
    const scores = Language.detectAll(utterance, options);
    const result = [];
    for (let i = 0; i < scores.length; i += 1) {
      const language = this.languagesAlpha3[scores[i][0]];
      if (language) {
        result.push({
          alpha3: language.alpha3,
          alpha2: language.alpha2,
          language: language.name,
          score: scores[i][1],
        });
        if (limit && result.length >= limit) {
          break;
        }
      }
    }
    return result;
  }

  /**
   * Given an utterance, an allow list of iso codes and the limit of results,
   * return the language with the best score.
   * The allowList is optional.
   * @param {String} utterance Utterance wich we want to guess the language.
   * @param {String[]} allowList allowList of accepted languages.
   * @return {Object} Best guess.
   */
  guessBest(utterance, allowList) {
    return this.guess(utterance, allowList, 1)[0];
  }

  addTrigrams(locale, sentence) {
    const language = this.languagesAlpha2[locale];
    const iso3 = language ? language.alpha3 : locale;
    const script = Language.getTopScript(sentence)[0];
    const trigrams = Language.getTrigrams(sentence);
    if (data[script]) {
      if (!data[script][iso3]) {
        data[script][iso3] = {};
      }
      trigrams.forEach((trigram) => {
        data[script][iso3][trigram] = 1;
      });
    }
  }

  addExtraSentence(locale, sentence) {
    this.extraSentences.push([locale, sentence]);
    this.addTrigrams(locale, sentence);
  }

  processExtraSentences() {
    this.extraSentences.forEach((item) => {
      this.addTrigrams(item[0], item[1]);
    });
  }

  static lansplit(s) {
    if (s.includes('|')) {
      return s.split('|');
    }
    const result = [];
    for (let i = 0; i < s.length; i += 3) {
      result.push(s.substr(i, 3));
    }
    return result;
  }

  static addModel(script, name, value) {
    const languages = data[script];
    const model = Language.lansplit(value);
    let weight = model.length;
    const trigrams = {};
    while (weight > 0) {
      weight -= 1;
      trigrams[model[weight]] = weight;
    }
    languages[name] = trigrams;
  }

  // eslint-disable-next-line class-methods-use-this
  addModel(script, name, value) {
    Language.addModel(script, name, value);
  }

  static buildModel() {
    Object.keys(data).forEach((script) => {
      const languages = data[script];
      Object.keys(languages).forEach((name) => {
        Language.addModel(script, name, languages[name]);
      });
    });
  }
}

Language.buildModel();

module.exports = { Language };
