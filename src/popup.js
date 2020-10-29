function alphabeticallyBy(property) {
  return function (a, b) {
    if (a[property] < b[property]) {
      return -1;
    }
    if (a[property] > b[property]) {
      return 1;
    }
    return 0;
  };
}

function difference(setA, setB) {
  let _difference = new Set(setA);
  for (let elem of setB) {
    _difference.delete(elem);
  }
  return _difference;
}

function isShiftInArray(_app, shiftSuffix, arr) {
  let result = true;
  let suffixedCallCenters = _app.shiftCallCenterDefsBySuffix[shiftSuffix];

  if (suffixedCallCenters) {
    suffixedCallCenters.map((cc) => {
      result = result && arr.includes(cc.id);
    });
  } else {
    result = false;
  }

  return result;
}

async function xhr(url, headers, method = "GET", body = null) {
  const response = await fetch(url, {
    headers: { ...headers, "request-timestamp": Date.now() },
    referrer: "https://dialpad.com/accounts",
    referrerPolicy: "no-referrer-when-downgrade",
    body,
    method,
    mode: "cors",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed XHR ${method} to ${url} (${response.status})`);
  }

  return await response.json();
}

const timeout = (ms) => new Promise((res) => setTimeout(res, ms));

async function modifyMembership(userId, callCenterId, add, headers, delayMs) {
  await timeout(delayMs);

  const url = `https://dialpad.com/api/operator/${userId}?group_id=${callCenterId}`;
  const body = add ? { add: true, skill_level: 100 } : { remove: true };

  console.log(`Will ${add ? "add" : "remove"} ${callCenterId}`);

  return xhr(url, headers, "PATCH", JSON.stringify(body));
}

async function modifyMemberships(userId, callCenterIds, add, headers) {
  console.log(
    `Will ${add ? "add" : "remove"} ${callCenterIds.size} call centers`
  );

  const SPACING_MS = add ? 325 : 750; // rough empirical observations
  const promises = Array.from(callCenterIds).map((callCenterId, i) =>
    modifyMembership(userId, callCenterId, add, headers, i * SPACING_MS)
  );

  return Promise.all(promises);
}

async function refreshUserData(_app) {
  const url = `https://dialpad.com/api/user/${_app.userId}?replay`;
  const { display_name, group_details, primary_email } = await xhr(
    url,
    _app.headers
  );
  const call_center_ids = group_details.map((group) => group.id);
  const userData = {
    call_center_ids,
    display_name,
    primary_email,
    isLoaded: true,
  };

  _app.userData = userData;
}

async function refreshCallCenterDefs(_app) {
  const url = "https://dialpad.com/api/group";
  const callCenterDefs = await xhr(url, _app.headers);

  _app.callCenterDefs = callCenterDefs.sort(alphabeticallyBy("display_name"));

  // pull out any call centers that represent shifts ("Arizona", "Arizona B", etc) into their own array
  let numCallCenters = _app.callCenterDefs.length;
  let currentCallCenterIndex = 0;
  let currentCallCenterRun = 0;
  let currentCallCenterPrefix = "";
  while (currentCallCenterIndex < numCallCenters) {
    currentCallCenterPrefix = _app.callCenterDefs[currentCallCenterIndex].display_name;
    currentCallCenterRun = 1;
    
    // as of 10/29, the election day call centers are of the form "ED " + <State> + " <Letter><Number>"
    // in this case, use "ED " + <State> as the prefix to match a run against
    let prefixMatch = currentCallCenterPrefix.match(new RegExp("(ED .+) ([A-Z][0-9]*)"));
    if (prefixMatch && prefixMatch.length > 1) currentCallCenterPrefix = prefixMatch[1];
    
    if (!_app.denylistedShiftPrefixes.includes(currentCallCenterPrefix)) {
      while (currentCallCenterRun + currentCallCenterIndex < numCallCenters) {
        // as of 10/26 we now have call centers named <State>, <State Letter>, and <State LetterNumber>
        // <State LetterNumber> call centers are for election day so let's gobble them up but not surface them in the UI
        let reMatch = _app.callCenterDefs[currentCallCenterIndex + currentCallCenterRun].display_name.match(new RegExp(currentCallCenterPrefix + " ([A-Z][0-9]*)"));

        if (reMatch && reMatch.length > 1) {
          currentCallCenterRun++;
        } else {
          break;
        }
      }
    }

    if (currentCallCenterRun > 2) {
      let currentRunIndex = 0;
      for (currentRunIndex = 0; currentRunIndex < currentCallCenterRun; currentRunIndex++) {
        let reMatch = _app.callCenterDefs[currentCallCenterIndex + currentRunIndex].display_name.match(new RegExp(currentCallCenterPrefix + "( ([A-Z][0-9]*))?"));
        if (reMatch) {
          let callCenterSuffix = "A"; // A shift call centers don't have a real suffix
          if (reMatch.length > 2 && reMatch[2]) callCenterSuffix = reMatch[2];
                    
          if (!_app.shiftCallCenterDefsBySuffix[callCenterSuffix]) {
            _app.shiftCallCenterDefsBySuffix[callCenterSuffix] = [];
          }
          _app.shiftCallCenterDefsBySuffix[callCenterSuffix].push(_app.callCenterDefs[currentCallCenterIndex + currentRunIndex]);
        }
      }

      _app.callCenterDefs.splice(currentCallCenterIndex, currentCallCenterRun);
      numCallCenters -= currentCallCenterRun;
    } else {
      currentCallCenterIndex += currentCallCenterRun;
    }
  }
}

// load up the most recent way we had the check boxes checked
function refreshCheckedCallCenterIds(_app) {
  chrome.storage.sync.get(["checkedCallCenterIds"], (value) => {
    console.log("Stored value (sync): ", value);
    const { checkedCallCenterIds } = value;

    _app.checkedCallCenterIds = checkedCallCenterIds ?? [];
  });
}

const app = new Vue({
  el: "#app",
  data: {
    userId: null,
    userData: {
      call_center_ids: [],
      display_name: null,
      primary_email: null,
      isLoaded: false,
    },
    headers: [],
    callCenterDefs: [],
    checkedCallCenterIds: [],
    shiftSuffixes: ["A", "B", "C", "D", "E", "F", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"],
    denylistedShiftPrefixes: ["National Spanish", "ED Spanish"],
    shiftCallCenterDefsBySuffix: [],
    isAssigning: false,
    hasAssigned: false,
  },
  methods: {
    assign: async function () {
      this.isAssigning = true;
      this.hasAssigned = true;

      try {
        await Promise.all([
          modifyMemberships(this.userId, this.toAdd, true, this.headers),
          modifyMemberships(this.userId, this.toRemove, false, this.headers),
        ]);
      } finally {
        await refreshUserData(this);
        this.isAssigning = false;
      }
    },
    isMember: function (callCenter) {
      return this.userData.call_center_ids.includes(callCenter.id);
    },
    isShiftMember: function(shiftSuffix) {
      return isShiftInArray(this, shiftSuffix, this.userData.call_center_ids);
    },
    isShiftChecked: function(shiftSuffix) {
      return isShiftInArray(this, shiftSuffix, this.checkedCallCenterIds);
    },
    checkAll: function () {
      let allCheckedIds = [...this.callCenterDefs.map((cc) => cc.id)];
      Object.keys(this.shiftCallCenterDefsBySuffix).map((shiftSuffix) => {
        this.shiftCallCenterDefsBySuffix[shiftSuffix].map((cc) => allCheckedIds.push(cc.id));
      });
      this.checkedCallCenterIds = allCheckedIds;
    },
    checkNone: function () {
      this.checkedCallCenterIds = [];
    },
    checkReset: function () {
      this.checkedCallCenterIds = [...this.userData.call_center_ids];
    },
    displayNameForCallCenterName: function(callCenterName) {
      const shiftDisplayTimes = [ "(6am ET)", "(9am ET)", "(12pm ET)", "(3pm ET)", "(6pm ET)", "(9pm ET)", "(ED 5am ET)", "(ED 5am ET)", "(ED 5am ET)",  "(ED 11am ET)", "(ED 11am ET)", "(ED 11am ET)", "(ED 5pm ET)", "(ED 5pm ET)", "(ED 5pm ET)"];
      const EDShiftDisplayTimes = ["(ED 5am ET)", "(ED 11am ET)", "(ED 5pm ET)"];
      const EDPrefix = "ED ";
      
      // special case denylisted shift call centers that are at 6am because they don't have the A suffix
      if (this.denylistedShiftPrefixes.includes(callCenterName)) return callCenterName + " " + shiftDisplayTimes[0];
      
      for (let shiftIndex = 0; shiftIndex < this.shiftSuffixes.length; shiftIndex++) {
        if (callCenterName.endsWith(" " + this.shiftSuffixes[shiftIndex])) {
          if (callCenterName.startsWith(EDPrefix) && shiftIndex < 3) {
            // Spanish call centers have the format ED Spanish <Letter> so they don't have an ED-specific suffix
            return callCenterName + " " + EDShiftDisplayTimes[shiftIndex];
          } else {
            return callCenterName + " " + shiftDisplayTimes[shiftIndex];
          }
        }
      }
      return callCenterName;
    },
    displayNameForCallCenter: function(callCenter) {
      return this.displayNameForCallCenterName(callCenter.display_name);
    }
  },
  computed: {
    have: function () {
      return new Set(this.userData.call_center_ids);
    },
    want: function () {
      return new Set(this.checkedCallCenterIds);
    },
    toAdd: function () {
      return difference(this.want, this.have);
    },
    toRemove: function () {
      return difference(this.have, this.want);
    },
    isClean: function () {
      return this.toAdd.size === 0 && this.toRemove.size === 0;
    },
    checkedShiftSuffixes: {
      get: function() {
        let result = [];
        this.shiftSuffixes.map((suffix) => {
          if (this.isShiftChecked(suffix)) result.push(suffix);
        });
        return result;
      },
      set: function(newValue) {
        let checkedIds = new Set (this.checkedCallCenterIds);
        this.shiftSuffixes.map((suffix) => {
          let suffixedCallCenters = this.shiftCallCenterDefsBySuffix[suffix];
          if (suffixedCallCenters) {
            suffixedCallCenters.map((cc) => {
              if (newValue.includes(suffix)) {
                checkedIds.add(cc.id);
              } else {
                checkedIds.delete(cc.id);
              }
            });
          }
        });
        this.checkedCallCenterIds = Array.from(checkedIds);
      }
    },
  },
  watch: {
    checkedCallCenterIds: function (checkedCallCenterIds) {
      console.log("Observed checkedCallCenterIds change", checkedCallCenterIds);
      chrome.storage.sync.set({ checkedCallCenterIds });
      this.hasAssigned = false;
    },
  },
});

async function init(_app) {
  chrome.storage.local.get(["headers", "userId"], async (value) => {
    const { headers, userId } = value;

    console.log("Stored value (local): ", value);

    _app.headers = headers;
    _app.userId = userId;

    refreshUserData(_app);
    refreshCallCenterDefs(_app);
    refreshCheckedCallCenterIds(_app);
  });
}

init(app);
