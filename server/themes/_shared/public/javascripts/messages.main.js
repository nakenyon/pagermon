// The message list Angular application.
//
// This lived inline in themes/<theme>/views/index.ejs, duplicated across all
// four themes. The four copies were byte-identical apart from whitespace,
// comment indentation, and the timestamp format in Compact Dark - which is to
// say they had already started to drift, and every change had to be made four
// times. This is the same treatment admin.main.js received in 59639629.
//
// Everything the server used to decide with EJS conditionals is now read from
// window.pagermonConfig, set by the template immediately before this file is
// loaded. The per-theme <script type="text/ng-template" id="/messages.html">
// table markup stays in each theme, because that genuinely differs.

(function () {
  var config = window.pagermonConfig || {};
  // Each theme's own timestamp format. Compact Dark shows seconds; the other
  // three do not. Preserved exactly as each theme had it.
  var timeFormat = config.timeFormat || 'HH:mm';

  var app = angular.module('app', ['ngRoute', 'ngResource', 'ngCookies', 'angular-highlight', 'ui.bootstrap'])

    .factory('socket', function ($rootScope) {

      var socket = io({ transports: ['websocket'], upgrade: false });
      return {
        open: function () {
          socket = io({ transports: ['websocket'], upgrade: false });
          socket.open();
        },
        on: function (eventName, callback) {
          socket.on(eventName, function () {
            var args = arguments;
            $rootScope.$apply(function () {
              callback.apply(socket, args);
            });
          });
        },
        emit: function (eventName, data, callback) {
          socket.emit(eventName, data, function () {
            var args = arguments;
            $rootScope.$apply(function () {
              if (callback) {
                callback.apply(socket, args);
              }
            });
          })
        },
        close: function () {
          socket.close();
        }
      };
    })

    .factory('adminSocket', function ($rootScope) {

      var adminSocket = io('/adminio', { transports: ['websocket'], upgrade: false });
      return {
        open: function () {
          adminSocket = io('/adminio', { transports: ['websocket'], upgrade: false });
          adminSocket.open();
        },
        on: function (eventName, callback) {
          adminSocket.on(eventName, function () {
            var args = arguments;
            $rootScope.$apply(function () {
              callback.apply(adminSocket, args);
            });
          });
        },
        emit: function (eventName, data, callback) {
          adminSocket.emit(eventName, data, function () {
            var args = arguments;
            $rootScope.$apply(function () {
              if (callback) {
                callback.apply(adminSocket, args);
              }
            });
          })
        },
        close: function () {
          adminSocket.close();
        }
      };
    })

    .factory('Api', ['$resource',
      function ($resource) {
        return {
          Messages: $resource('/api/messages/'),
          NewMessage: $resource('/api/messages/:id', { id: '@id' }),
          MessageSearch: $resource('/api/messageSearch/'),
          Agencies: $resource('/api/capcodes/agency'),
          Systems: $resource('/api/systems')
        };
      }])

    .run(function ($anchorScroll, $window) {
      // hack to scroll to top when navigating to new URLS but not back/forward
      var wrap = function (method) {
        var orig = $window.window.history[method];
        $window.window.history[method] = function () {
          var retval = orig.apply(this, Array.prototype.slice.call(arguments));
          $anchorScroll();
          return retval;
        };
      };
      wrap('pushState');
      wrap('replaceState');
    })

    // Controller
    // TODO: optimise this whole section
    .controller('MessageController', ['$scope', '$routeParams', 'Api', 'socket', 'adminSocket', '$cookies', '$location', '$window', function ($scope, $routeParams, Api, socket, adminSocket, $cookies, $location, $window) {
      // Was rendered by EJS directly into the scope. Note $scope.user is the
      // *string* the server rendered, which is "false" when logged out - and a
      // non-empty string is truthy, so `ng-if="user"` is true either way. That
      // is pre-existing behaviour and is preserved here deliberately; changing
      // it would change which alias column anonymous viewers get.
      $scope.user = config.user;
      $scope.role = config.role;

      // get new message on socket event
      $scope.$on('$viewContentLoaded', function () {

        // Which socket to listen on. This was a nest of EJS conditionals; the
        // rules are unchanged:
        //  - with apiSecurity on, an admin gets the admin namespace, any other
        //    logged-in user gets the public one, and an anonymous visitor gets
        //    neither (they cannot see the page at all).
        //  - with apiSecurity off, an admin gets the admin namespace only when
        //    HideCapcode or pdwMode is on, because those are the modes where
        //    the public feed is redacted. Otherwise everyone shares the public
        //    feed.
        var socketMode;
        if (config.apisecurity) {
          if (config.login && config.role == 'admin') {
            socketMode = adminSocket;
            adminSocket.open();
          } else if (config.login) {
            socketMode = socket;
            socket.open();
            adminSocket.close();
          } else {
            socketMode = socket;
            socket.close();
            adminSocket.close();
          }
        } else if ((config.hidecapcode || config.pdwmode) && config.login && config.role == 'admin') {
          socketMode = adminSocket;
          adminSocket.open();
        } else {
          socketMode = socket;
          socket.open();
          adminSocket.close();
        }

        // Notifications are suppressed only for anonymous visitors under
        // apiSecurity, who receive no messages anyway.
        var notificationsAllowed = !config.apisecurity || config.login;

        socketMode.on('messagePost', function (message) {
          if (notificationsAllowed && $scope.notificationEnabled == 'true') {
            if (!message.agency) {
              //Not showing messages for things that we don't know
            } else {
              notify("PagerMon - " + message.agency + " - " + message.alias, message.message);
            }
          }

          // only bother getting the new message if we're on page 1
          if ($scope.init.currentPage === 1) {
            console.log('New Message ID: ' + message.id + ' currentPage: ' + $scope.init.currentPage);
            var datetime = moment.unix(message.timestamp);
            message.date = datetime.format("YYYY-MM-DD");
            message.timestamp = datetime.format(timeFormat);
            if ($routeParams.q || $routeParams.agency || $routeParams.address) {
              if ($routeParams.q) {
                var patt = new RegExp($routeParams.q, 'i');
                if (patt.test(message.message) || patt.test(message.agency) || patt.test(message.address) || patt.test(message.alias) || patt.test(message.source)) {
                  $scope.messages.unshift(message);
                  $scope.messages.pop();
                }
              }
              if ($routeParams.agency) {
                var patt = new RegExp($routeParams.agency, 'i');
                if (patt.test(message.agency)) {
                  $scope.messages.unshift(message);
                  $scope.messages.pop();
                }
              }
              if ($routeParams.address) {
                var patt = new RegExp($routeParams.address, 'i');
                if (patt.test(message.address) || patt.test(message.alias) || patt.test(message.source)) {
                  $scope.messages.unshift(message);
                  $scope.messages.pop();
                }
              }
            } else {
              $scope.messages.unshift(message);
              $scope.messages.pop();
            }
          }
        });
      });

      $scope.updateData = function (page, query) {
        // check if browser supports notifications
        if ("Notification" in window) {
          $scope.notificationSupport = true;
        }
        // spinner start
        $scope.spinner = 'fa-spin';
        $scope.loading = true;
        $scope.popoverEl = '';
        // get limit from cookiestore
        var curPage = page || $routeParams.page || '1';
        var limit = $cookies.get('messageLimit') || '';
        $scope.notificationEnabled = $cookies.get('notificationEnabled') || 'true';

        var queryObj = {};
        queryObj.page = curPage;
        queryObj.limit = limit;

        if ($routeParams.q || query) {
          $scope.query = query || $routeParams.q;
          $scope.origQuery = query || $routeParams.q;
          $scope.hasQuery = true;
          queryObj.q = query || $routeParams.q;
        } else {
          $scope.query = '';
          $scope.hasQuery = false;
        }

        if ($routeParams.agency || $routeParams.address || $routeParams.alias) {
          $scope.filter = $routeParams.agency || $routeParams.address || $routeParams.alias;
          $scope.hasQuery = true;
          if ($routeParams.agency)
            queryObj.agency = $routeParams.agency;
          if ($routeParams.address)
            queryObj.address = $routeParams.address;
          if ($routeParams.alias)
            queryObj.alias = $routeParams.alias;
        }

        if (page) {
          // if page then we have been passed a page var directly to the updateData func, which means we clicked on a page change button
          // encoding everything prevents issues with some special chars
          var qArray = [];
          if (queryObj.q)
            qArray.push('q=' + encodeURIComponent(queryObj.q));
          if (queryObj.address)
            qArray.push('address=' + encodeURIComponent(queryObj.address));
          if (queryObj.agency)
            qArray.push('agency=' + encodeURIComponent(queryObj.agency));
          if (queryObj.alias)
            qArray.push('alias=' + encodeURIComponent(queryObj.alias));
          if (queryObj.page > 1)
            qArray.push('page=' + encodeURIComponent(queryObj.page));

          // default query string is "/" - this prevents the state from not passing on firefox
          var qString = '/';
          if (qArray.length > 0) {
            qString = '?' + qArray.join('&');
          }
          window.history.pushState('', '', qString);
        }

        // Pagination window: at most ten page links, centred on the current
        // page once there are more than ten.
        var paginate = function (init) {
          init.currentPage++;
          var startPage, endPage;
          if (init.pageCount <= 10) {
            // less than 10 total pages so show all
            startPage = 1;
            endPage = init.pageCount;
          } else {
            // more than 10 total pages so calculate start and end pages
            if (init.currentPage <= 6) {
              startPage = 1;
              endPage = 10;
            } else if (init.currentPage + 4 >= init.pageCount) {
              startPage = init.pageCount - 9;
              endPage = init.pageCount;
            } else {
              startPage = init.currentPage - 5;
              endPage = init.currentPage + 4;
            }
          }
          init.pages = $scope.range(startPage, endPage);
          return init;
        };

        var applyResults = function (results) {
          $scope.init = paginate(results.init);
          angular.forEach(results.messages, function (result) {
            var datetime = moment.unix(result.timestamp);
            result.date = datetime.format("YYYY-MM-DD");
            result.timestamp = datetime.format(timeFormat);
            result.message = $scope.htmlEntities(result.message);
          });
          $scope.spinner = '';
          $scope.loading = false;
          $scope.messages = results.messages;
          // spinner end
        };

        var onError = function (source) {
          return function (error) {
            console.log('Error on Api.' + source + '.query!', error);
            $scope.spinner = '';
            $scope.loading = false;
          };
        };

        if (queryObj.q || queryObj.agency || queryObj.address || queryObj.alias) {
          Api.MessageSearch.get(queryObj).$promise.then(applyResults, onError('MessageSearch'));
        } else {
          Api.Messages.get({ page: curPage, limit: limit }).$promise.then(applyResults, onError('Messages'));
        }
      };
      // run the updateData function on load
      $scope.updateData();

      // helper functions below
      $scope.range = function (min, max, step) {
        step = step || 1;
        var input = [];
        for (var i = min; i <= max; i += step) {
          input.push(i);
        }
        return input;
      };

      $scope.htmlEntities = function (str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, ' ').replace(/>/g, ' ').replace(/"/g, '&quot;');
      }

      $scope.padDigits = function (number, digits) {
        return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number;
      }

      $scope.setCookie = function (cookie, value) {
        var expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 30);
        $cookies.put(cookie, value, { 'expires': expireDate });
        $scope.updateData($scope.init.currentPage);
      };

      $scope.toggleNotifications = function () {
        if ($scope.notificationEnabled == 'true') {
          $scope.setCookie('notificationEnabled', 'false');
        } else {
          $scope.setCookie('notificationEnabled', 'true');
          Notification.requestPermission(function (permission) {
            if (!('permission' in Notification)) {
              Notification.permission = permission;
            }
          });
        }
      };

      $scope.clearSearch = function () {
        $scope.query = '';
      };

      // destroy socket when we navigate away
      $scope.$on('$destroy', function () {
        socket.close();
      });

    }])

    // Routes
    .config(['$routeProvider', '$locationProvider', function ($routeProvider, $locationProvider) {
      $routeProvider
        .when('/', {
          templateUrl: '/messages.html',
          controller: 'MessageController'
        })
        .when('/:page', {
          templateUrl: '/messages.html',
          controller: 'MessageController'
        })
      $locationProvider.html5Mode({ enabled: true, requireBase: false, rewriteLinks: false });
    }]);

  window.notify = function notify(notifyTitle, notifyMessage) {
    if (!("Notification" in window)) {
      console.log("This browser does not support desktop notification");
    } else if (Notification.permission === "granted") {
      var options = {
        body: notifyMessage,
        icon: '/favicon.ico'
      };
      var notification = new Notification(notifyTitle, options);
    }
    else if (Notification.permission !== 'denied') {
      Notification.requestPermission(function (permission) {
        if (!('permission' in Notification)) {
          Notification.permission = permission;
        }

        if (permission === "granted") {
          var options = {
            body: notifyMessage,
            icon: '/favicon.ico',
          };
          var notification = new Notification(notifyTitle, options);
        }
      });
    }
  };
})();
