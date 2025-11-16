angular.module('angular-highlight', []).directive('highlight', () => {
    const component = function (scope, element, attrs) {
        if (!attrs.highlightClass) {
            attrs.highlightClass = 'angular-highlight';
        }

        const replacer = function (match, item) {
            return `<a href="/?q=${match}" class="${attrs.highlightClass}">${match}</a>`;
        };
        const tokenize = function (keywords) {
            keywords = keywords.replace(new RegExp(',$', 'g'), '').split(',');
            let i;
            const l = keywords.length;
            for (i = 0; i < l; i++) {
                keywords[i] = keywords[i].replace(new RegExp('^ | $', 'g'), '');
            }
            return keywords;
        };

        scope.$watch('keywords', () => {
            // console.log("scope.keywords",scope.keywords);
            if (!scope.keywords || scope.keywords == '') {
                element.html(scope.highlight);
                return false;
            }

            const tokenized = tokenize(scope.keywords);
            const regex = new RegExp(tokenized.join('|'), 'gmi');

            // console.log("regex",regex);

            // Find the words
            const html = scope.highlight.replace(regex, replacer);

            element.html(html);
        });
    };
    return {
        link: component,
        replace: false,
        scope: {
            highlight: '=',
            keywords: '=',
        },
    };
});
